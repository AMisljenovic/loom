package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"reflect"
	"sort"
	"sync"
	"time"

	"github.com/your-org/loom/internal/tools"
)

type ServerStatus struct {
	Server    string `json:"server"`
	State     string `json:"state"`
	Message   string `json:"message,omitempty"`
	ToolCount int    `json:"toolCount,omitempty"`
	Attempt   int    `json:"attempt,omitempty"`
}

type StatusFunc func(ServerStatus)

type Manager struct {
	mu       sync.RWMutex
	cfg      Config
	started  bool
	servers  map[string]*serverRuntime
	tools    []tools.Tool
	onStatus StatusFunc

	// lifeCtx is cancelled by Close; it bounds long-lived background work
	// (server-crash retry loops, post-init refresh notifications) so the
	// agent process can exit without leaving goroutines sleeping in retry
	// timers or trying to re-spawn dead subprocesses.
	lifeCtx    context.Context
	lifeCancel context.CancelFunc
}

type serverRuntime struct {
	name    string
	cfg     ServerConfig
	client  *Client
	cmd     *exec.Cmd
	stdin   ioCloser
	done    chan struct{}
	stopped bool
	tools   []RemoteTool
}

type ioCloser interface {
	Close() error
}

func NewManager(onStatus StatusFunc) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{
		cfg:        Config{Servers: map[string]ServerConfig{}},
		servers:    map[string]*serverRuntime{},
		onStatus:   onStatus,
		lifeCtx:    ctx,
		lifeCancel: cancel,
	}
}

func (m *Manager) Configure(ctx context.Context, cfg Config) error {
	normalized, err := NormalizeConfig(cfg)
	if err != nil {
		return err
	}
	m.mu.Lock()
	started := m.started
	old := m.cfg
	m.cfg = normalized
	m.mu.Unlock()

	if !started {
		return nil
	}
	return m.applyConfig(ctx, old, normalized)
}

func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return nil
	}
	m.started = true
	cfg := m.cfg
	m.mu.Unlock()
	return m.applyConfig(ctx, Config{Servers: map[string]ServerConfig{}}, cfg)
}

func (m *Manager) Tools() []tools.Tool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]tools.Tool(nil), m.tools...)
}

func (m *Manager) Close() {
	// Cancel the lifecycle context first so any in-flight retry sleeps,
	// post-crash respawn attempts, and refresh notifications return
	// immediately instead of trying to start fresh subprocesses during
	// shutdown.
	if m.lifeCancel != nil {
		m.lifeCancel()
	}
	m.mu.Lock()
	runtimes := make([]*serverRuntime, 0, len(m.servers))
	for _, rt := range m.servers {
		runtimes = append(runtimes, rt)
	}
	m.servers = map[string]*serverRuntime{}
	m.tools = nil
	m.mu.Unlock()
	for _, rt := range runtimes {
		m.stopRuntime(rt)
	}
}

func (m *Manager) applyConfig(ctx context.Context, oldCfg, newCfg Config) error {
	for name, oldServer := range oldCfg.Servers {
		next, stillExists := newCfg.Servers[name]
		if !stillExists || !reflect.DeepEqual(oldServer, next) {
			rt := m.removeRuntime(name)
			if rt != nil {
				m.stopRuntime(rt)
			}
		}
	}

	for name, server := range newCfg.Servers {
		oldServer, existed := oldCfg.Servers[name]
		if existed && reflect.DeepEqual(oldServer, server) {
			continue
		}
		if err := m.startRuntime(ctx, name, server, 1); err != nil {
			m.emit(ServerStatus{Server: name, State: "error", Message: err.Error(), Attempt: 1})
		}
	}
	m.rebuildTools()
	return nil
}

func (m *Manager) startRuntime(ctx context.Context, name string, cfg ServerConfig, attempt int) error {
	m.emit(ServerStatus{Server: name, State: "starting", Attempt: attempt})
	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Env = envWithOverrides(cfg.Env)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go logStderr(name, stderr)

	client := NewClient(stdout, stdin, stdin.Close)
	rt := &serverRuntime{name: name, cfg: cfg, client: client, cmd: cmd, stdin: stdin, done: make(chan struct{})}
	client.OnNotification("notifications/tools/list_changed", func(json.RawMessage) {
		if err := m.refreshTools(m.lifeCtx, name); err != nil {
			m.emit(ServerStatus{Server: name, State: "error", Message: err.Error()})
		}
	})
	client.Start()

	initCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := client.Initialize(initCtx); err != nil {
		_ = client.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		return fmt.Errorf("initialize: %w", err)
	}
	remoteTools, err := client.ListTools(initCtx)
	if err != nil {
		_ = client.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
		return fmt.Errorf("tools/list: %w", err)
	}
	rt.tools = remoteTools

	m.mu.Lock()
	m.servers[name] = rt
	m.mu.Unlock()
	m.rebuildTools()
	m.emit(ServerStatus{Server: name, State: "ready", ToolCount: len(remoteTools), Attempt: attempt})
	go m.monitorRuntime(rt, attempt)
	return nil
}

func (m *Manager) refreshTools(ctx context.Context, name string) error {
	m.mu.RLock()
	rt := m.servers[name]
	m.mu.RUnlock()
	if rt == nil || rt.client == nil {
		return nil
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	remoteTools, err := rt.client.ListTools(reqCtx)
	if err != nil {
		return err
	}
	m.mu.Lock()
	if current := m.servers[name]; current == rt {
		rt.tools = remoteTools
	}
	m.mu.Unlock()
	m.rebuildTools()
	m.emit(ServerStatus{Server: name, State: "ready", ToolCount: len(remoteTools)})
	return nil
}

func (m *Manager) monitorRuntime(rt *serverRuntime, attempt int) {
	err := rt.cmd.Wait()
	close(rt.done)
	m.mu.Lock()
	stopped := rt.stopped
	current := m.servers[rt.name] == rt
	if current {
		delete(m.servers, rt.name)
	}
	m.mu.Unlock()
	if stopped {
		m.rebuildTools()
		return
	}
	message := "exited"
	if err != nil {
		message = err.Error()
	}
	m.emit(ServerStatus{Server: rt.name, State: "crashed", Message: message, Attempt: attempt})
	m.rebuildTools()

	delays := []time.Duration{time.Second, 5 * time.Second, 30 * time.Second}
	if attempt > len(delays) {
		m.emit(ServerStatus{Server: rt.name, State: "failed", Message: "retry limit reached", Attempt: attempt})
		return
	}
	if !sleepCtx(m.lifeCtx, delays[attempt-1]) {
		return
	}

	m.mu.RLock()
	cfg, stillConfigured := m.cfg.Servers[rt.name]
	m.mu.RUnlock()
	if !stillConfigured {
		return
	}
	if err := m.startRuntime(m.lifeCtx, rt.name, cfg, attempt+1); err != nil {
		m.emit(ServerStatus{Server: rt.name, State: "error", Message: err.Error(), Attempt: attempt + 1})
		go m.retryAfterFailure(rt.name, cfg, attempt+1)
	}
}

func (m *Manager) retryAfterFailure(name string, cfg ServerConfig, attempt int) {
	delays := []time.Duration{time.Second, 5 * time.Second, 30 * time.Second}
	if attempt > len(delays) {
		m.emit(ServerStatus{Server: name, State: "failed", Message: "retry limit reached", Attempt: attempt})
		return
	}
	if !sleepCtx(m.lifeCtx, delays[attempt-1]) {
		return
	}
	m.mu.RLock()
	current, stillConfigured := m.cfg.Servers[name]
	m.mu.RUnlock()
	if !stillConfigured || !reflect.DeepEqual(current, cfg) {
		return
	}
	if err := m.startRuntime(m.lifeCtx, name, cfg, attempt+1); err != nil {
		m.emit(ServerStatus{Server: name, State: "error", Message: err.Error(), Attempt: attempt + 1})
		go m.retryAfterFailure(name, cfg, attempt+1)
	}
}

// sleepCtx blocks for d or until ctx is cancelled. Returns true if the
// sleep completed normally, false if ctx fired first — callers use the
// return value to bail out of retry loops on shutdown.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	if ctx == nil {
		time.Sleep(d)
		return true
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

func (m *Manager) removeRuntime(name string) *serverRuntime {
	m.mu.Lock()
	defer m.mu.Unlock()
	rt := m.servers[name]
	delete(m.servers, name)
	return rt
}

func (m *Manager) stopRuntime(rt *serverRuntime) {
	m.mu.Lock()
	rt.stopped = true
	m.mu.Unlock()
	if rt.client != nil {
		_ = rt.client.Close()
	}
	select {
	case <-rt.done:
	case <-time.After(5 * time.Second):
		_ = rt.cmd.Process.Kill()
		<-rt.done
	}
	m.emit(ServerStatus{Server: rt.name, State: "stopped"})
}

func (m *Manager) rebuildTools() {
	m.mu.Lock()
	defer m.mu.Unlock()
	var all []tools.Tool
	names := make([]string, 0, len(m.servers))
	for name := range m.servers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		rt := m.servers[name]
		all = append(all, ToTools(name, rt.tools, func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			return m.call(ctx, rt.name, toolName, input)
		})...)
	}
	m.tools = all
}

func (m *Manager) call(parent context.Context, serverName, toolName string, input json.RawMessage) (string, error) {
	m.mu.RLock()
	rt := m.servers[serverName]
	m.mu.RUnlock()
	if rt == nil || rt.client == nil {
		return "", fmt.Errorf("MCP server %q is not available", serverName)
	}
	// Overlay the 120s call timeout on top of the task ctx so a user cancel
	// short-circuits before the timeout, and a hung server still bounces.
	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()
	result, err := rt.client.CallTool(ctx, toolName, input)
	if err != nil {
		return "", err
	}
	return RenderToolResult(result)
}

func (m *Manager) emit(status ServerStatus) {
	if m.onStatus != nil {
		m.onStatus(status)
	}
}

func logStderr(serverName string, stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		log.Printf("mcp[%s]: %s", serverName, scanner.Text())
	}
}
