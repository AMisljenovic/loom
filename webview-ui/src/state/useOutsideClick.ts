import { useEffect, useRef } from "react";

export function useOutsideClick(onClose: () => void, enabled = true) {
    const ref = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!enabled) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("keydown", keyHandler);
        };
    }, [onClose, enabled]);

    return ref;
}
