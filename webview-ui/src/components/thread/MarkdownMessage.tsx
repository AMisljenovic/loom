import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeMarkdownHref, stripStructuralTags } from "../../util/markdown";

interface MarkdownMessageProps {
    text: string;
}

export function MarkdownMessage({ text }: MarkdownMessageProps) {
    const rendered = stripStructuralTags(text);
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                a({ href, children }) {
                    const safeHref = safeMarkdownHref(href);
                    if (!safeHref) {
                        return <span>{children}</span>;
                    }
                    return <a href={safeHref} rel="noreferrer" target="_blank">{children}</a>;
                },
                code({ className, children, ...props }) {
                    const isBlock = /language-/.test(className ?? "");
                    if (isBlock) {
                        return (
                            <code className={className} {...props}>
                                {children}
                            </code>
                        );
                    }
                    return <code {...props}>{children}</code>;
                },
            }}
        >
            {rendered}
        </ReactMarkdown>
    );
}
