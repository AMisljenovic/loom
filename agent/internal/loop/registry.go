package loop

import (
	"context"
	"encoding/json"
	"sync"
)

type TaskStatus string

const (
	TaskRunning   TaskStatus = "running"
	TaskCompleted TaskStatus = "completed"
	TaskCancelled TaskStatus = "cancelled"
	TaskError     TaskStatus = "error"
)

type TaskNode struct {
	ID             string
	ParentID       string
	RootID         string
	Type           string
	Task           string
	Status         TaskStatus
	Depth          int
	Cancel         context.CancelFunc
	Children       []string
	InputTokens    int64
	OutputTokens   int64
	ToolCalls      int
	FilesInspected map[string]bool
}

type TaskRegistry struct {
	mu    sync.Mutex
	tasks map[string]*TaskNode
}

func NewTaskRegistry() *TaskRegistry {
	return &TaskRegistry{tasks: make(map[string]*TaskNode)}
}

func (r *TaskRegistry) Register(id, parentID, typ, task string, cancel context.CancelFunc) *TaskNode {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.tasks == nil {
		r.tasks = make(map[string]*TaskNode)
	}
	depth := 0
	rootID := id
	if parentID != "" {
		if parent := r.tasks[parentID]; parent != nil {
			depth = parent.Depth + 1
			rootID = parent.RootID
			parent.Children = append(parent.Children, id)
		}
	}
	node := &TaskNode{
		ID:             id,
		ParentID:       parentID,
		RootID:         rootID,
		Type:           typ,
		Task:           task,
		Status:         TaskRunning,
		Depth:          depth,
		Cancel:         cancel,
		FilesInspected: map[string]bool{},
	}
	r.tasks[id] = node
	return cloneTaskNode(node)
}

func (r *TaskRegistry) Complete(id string, status TaskStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if node := r.tasks[id]; node != nil {
		node.Status = status
	}
}

func (r *TaskRegistry) Cancel(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	node := r.tasks[id]
	if node == nil {
		return false
	}
	r.cancelLocked(node)
	return true
}

func (r *TaskRegistry) cancelLocked(node *TaskNode) {
	if node.Cancel != nil {
		node.Cancel()
	}
	node.Status = TaskCancelled
	for _, childID := range node.Children {
		if child := r.tasks[childID]; child != nil {
			r.cancelLocked(child)
		}
	}
}

func (r *TaskRegistry) Node(id string) *TaskNode {
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneTaskNode(r.tasks[id])
}

func (r *TaskRegistry) RemoveTree(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.removeTreeLocked(id)
}

func (r *TaskRegistry) removeTreeLocked(id string) {
	node := r.tasks[id]
	if node == nil {
		return
	}
	for _, childID := range node.Children {
		r.removeTreeLocked(childID)
	}
	delete(r.tasks, id)
}

func (r *TaskRegistry) RecordUsage(id string, input, output int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if node := r.tasks[id]; node != nil {
		node.InputTokens += input
		node.OutputTokens += output
	}
}

func (r *TaskRegistry) RecordToolCall(id, name string, input json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	node := r.tasks[id]
	if node == nil {
		return
	}
	node.ToolCalls++
	var in map[string]any
	if err := json.Unmarshal(input, &in); err == nil {
		if path, ok := in["path"].(string); ok && path != "" && (name == "read_file" || name == "get_diagnostics") {
			node.FilesInspected[path] = true
		}
	}
}

func (r *TaskRegistry) CountDescendants(rootID string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	root := r.tasks[rootID]
	if root == nil {
		return 0
	}
	return r.countDescendantsLocked(root)
}

func (r *TaskRegistry) countDescendantsLocked(node *TaskNode) int {
	total := len(node.Children)
	for _, childID := range node.Children {
		if child := r.tasks[childID]; child != nil {
			total += r.countDescendantsLocked(child)
		}
	}
	return total
}

func (r *TaskRegistry) TreeUsage(rootID string) (input, output int64, subAgents int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	root := r.tasks[rootID]
	if root == nil {
		return 0, 0, 0
	}
	return r.treeUsageLocked(root, root.ID)
}

func (r *TaskRegistry) treeUsageLocked(node *TaskNode, rootID string) (input, output int64, subAgents int) {
	if node.ID != rootID {
		input += node.InputTokens
		output += node.OutputTokens
		subAgents++
	}
	for _, childID := range node.Children {
		if child := r.tasks[childID]; child != nil {
			ci, co, cs := r.treeUsageLocked(child, rootID)
			input += ci
			output += co
			subAgents += cs
		}
	}
	return input, output, subAgents
}

func cloneTaskNode(node *TaskNode) *TaskNode {
	if node == nil {
		return nil
	}
	clone := *node
	clone.Children = append([]string(nil), node.Children...)
	clone.FilesInspected = make(map[string]bool, len(node.FilesInspected))
	for path, ok := range node.FilesInspected {
		clone.FilesInspected[path] = ok
	}
	return &clone
}
