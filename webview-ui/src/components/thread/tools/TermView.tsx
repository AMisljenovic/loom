import * as Ico from "../../../brand/icons";

interface TermViewProps {
    input: unknown;
    output: string | undefined;
    liveOutput?: string;
}

export function TermView({ input, output, liveOutput }: TermViewProps) {
    const command =
        typeof input === "object" && input !== null && "command" in input
            ? String((input as Record<string, unknown>).command)
            : undefined;

    const text = liveOutput ?? output;

    return (
        <div className="term">
            {command && (
                <div className="term-head">
                    <Ico.Terminal size={12} />
                    <code className="term-cmd">$ {command}</code>
                </div>
            )}
            {text && (
                <pre className="term-body">
                    <code>{text}</code>
                </pre>
            )}
        </div>
    );
}
