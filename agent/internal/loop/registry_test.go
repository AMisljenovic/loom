package loop

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

// TestRegisterAtomicTreeLimit fires N goroutines at Register against a
// root tree, verifying that exactly subAgentMaxPerTaskTree sub-tasks
// register and the rest fail with ErrTreeLimitExceeded. With the TOCTOU
// race in the previous design, parallel callers could all observe the
// not-yet-full state and over-register. Run under `-race`.
func TestRegisterAtomicTreeLimit(t *testing.T) {
	registry := NewTaskRegistry()
	if err := registry.Register("root", "", "main", "root", func() {}); err != nil {
		t.Fatalf("register root: %v", err)
	}

	const N = 100
	var (
		wg            sync.WaitGroup
		successes     atomic.Int64
		limitFailures atomic.Int64
		otherFailures atomic.Int64
	)
	start := make(chan struct{})
	for i := 0; i < N; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			id := fmt.Sprintf("child-%d", i)
			err := registry.Register(id, "root", "research", "task", func() {})
			switch {
			case err == nil:
				successes.Add(1)
			case errors.Is(err, ErrTreeLimitExceeded):
				limitFailures.Add(1)
			default:
				otherFailures.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()

	if otherFailures.Load() != 0 {
		t.Fatalf("unexpected non-limit failures: %d", otherFailures.Load())
	}
	if got, want := int(successes.Load()), subAgentMaxPerTaskTree; got != want {
		t.Fatalf("expected exactly %d successes, got %d (limitFailures=%d)", want, got, limitFailures.Load())
	}
	if got, want := int(limitFailures.Load()), N-subAgentMaxPerTaskTree; got != want {
		t.Fatalf("expected %d limit failures, got %d", want, got)
	}

	if descendants := registry.CountDescendants("root"); descendants != subAgentMaxPerTaskTree {
		t.Fatalf("expected root to have %d descendants, got %d", subAgentMaxPerTaskTree, descendants)
	}
}

func TestRegisterDepthLimitTyped(t *testing.T) {
	registry := NewTaskRegistry()
	if err := registry.Register("root", "", "main", "root", func() {}); err != nil {
		t.Fatalf("register root: %v", err)
	}
	if err := registry.Register("child", "root", "research", "child", func() {}); err != nil {
		t.Fatalf("register child: %v", err)
	}
	if err := registry.Register("grandchild", "child", "research", "grandchild", func() {}); err != nil {
		t.Fatalf("register grandchild: %v", err)
	}
	err := registry.Register("greatgrand", "grandchild", "research", "ggc", func() {})
	if !errors.Is(err, ErrDepthExceeded) {
		t.Fatalf("expected ErrDepthExceeded, got %v", err)
	}
}
