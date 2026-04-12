import ReactMarkdown from "react-markdown";

type Props = {
  /** Partial markdown while streaming is OK; react-markdown tolerates incomplete constructs. */
  children: string;
};

export function CoachMarkdown({ children }: Props) {
  return (
    <ReactMarkdown
      components={{
        p({ children: c }) {
          return <p className="mb-3 last:mb-0">{c}</p>;
        },
        strong({ children: c }) {
          return (
            <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{c}</strong>
          );
        },
        em({ children: c }) {
          return <em className="italic">{c}</em>;
        },
        ul({ children: c }) {
          return <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{c}</ul>;
        },
        ol({ children: c }) {
          return <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{c}</ol>;
        },
        li({ children: c }) {
          return <li className="leading-relaxed">{c}</li>;
        },
        h1({ children: c }) {
          return (
            <h4 className="mb-2 mt-4 text-base font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50">
              {c}
            </h4>
          );
        },
        h2({ children: c }) {
          return (
            <h4 className="mb-2 mt-4 text-base font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50">
              {c}
            </h4>
          );
        },
        h3({ children: c }) {
          return (
            <h4 className="mb-2 mt-4 text-sm font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50">
              {c}
            </h4>
          );
        },
        code({ className, children: c, ...props }) {
          const inline = className == null || className === "";
          return inline ? (
            <code
              className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
              {...props}
            >
              {c}
            </code>
          ) : (
            <code className={className} {...props}>
              {c}
            </code>
          );
        },
        pre({ children: c }) {
          return (
            <pre className="mb-3 overflow-x-auto rounded-lg bg-zinc-100 p-3 font-mono text-xs text-zinc-800 last:mb-0 dark:bg-zinc-900 dark:text-zinc-200">
              {c}
            </pre>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
