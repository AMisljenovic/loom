
interface RawViewProps {
    input: unknown;
    output: string | undefined;
}

export function RawView({ input, output }: RawViewProps) {
    return (
        <div className="raw-view">
            {input !== undefined && (
                <pre className="raw-block input-block">
                    <code>{JSON.stringify(input, null, 2)}</code>
                </pre>
            )}
            {output !== undefined && (
                <pre className="raw-block output-block">
                    <code>{output}</code>
                </pre>
            )}
        </div>
    );
}
