import type { CommandCatalogueEntry } from "../../../src/shared/protocol";

interface CommandPaletteProps {
    commands: CommandCatalogueEntry[];
    selectedIndex: number;
    onSelect: (command: CommandCatalogueEntry) => void;
}

export function CommandPalette({ commands, selectedIndex, onSelect }: CommandPaletteProps) {
    if (commands.length === 0) return null;
    return (
        <div className="sug-popover command-popover" role="listbox" aria-label="Slash commands">
            {commands.map((command, i) => (
                <div
                    key={`${command.source}:${command.name}`}
                    className={`sug-item${i === selectedIndex ? " active" : ""}`}
                    role="option"
                    aria-selected={i === selectedIndex}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(command);
                    }}
                >
                    <span className="sug-label">/{command.name}</span>
                    <span className="sug-path">{command.argumentHint || command.description || command.source}</span>
                </div>
            ))}
        </div>
    );
}
