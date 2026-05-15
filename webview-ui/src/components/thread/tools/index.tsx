import type { Msg } from "../../../../../src/shared/protocol";
import { parseRipgrep } from "../../../util/parseToolOutput";
import { DiffView } from "./DiffView";
import { RawView } from "./RawView";
import { ReadView } from "./ReadView";
import { SearchView } from "./SearchView";
import { TermView } from "./TermView";

interface ToolBodyProps {
    msg: Extract<Msg, { role: "tool" }>;
    pendingDiff?: string;
    liveOutput?: string;
}

export function ToolBody({ msg, pendingDiff, liveOutput }: ToolBodyProps) {
    const { name, input, output } = msg;
    const text = liveOutput ?? output;

    if (name === "apply_diff") {
        const unified = pendingDiff ?? output;
        if (unified) {
            const path =
                typeof input === "object" && input !== null && "path" in input
                    ? String((input as Record<string, unknown>).path)
                    : undefined;
            return <DiffView unified={unified} relPath={path} />;
        }
        return <RawView input={input} output={output} />;
    }

    if (name === "run_command") {
        return <TermView input={input} output={output} liveOutput={liveOutput} />;
    }

    if (name === "read_file") {
        return <ReadView output={text} />;
    }

    if (name === "grep" || name === "search" || name === "find_references" || name === "find_symbol") {
        if (text) {
            const results = parseRipgrep(text);
            if (results && results.length > 0) {
                return <SearchView output={text} />;
            }
        }
        return <RawView input={input} output={text} />;
    }

    return <RawView input={input} output={text} />;
}
