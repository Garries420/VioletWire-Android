/** Standard filled Material backspace/send silhouettes, matching the Xtra controls. */
export function AndroidComposerIcon({
  kind,
}: {
  kind: "backspace" | "send" | "keyboard";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path
        d={
          kind === "keyboard"
            ? "M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zM5 8h2v2H5zm3 0h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2zm3 0h2v2h-2zM5 11h2v2H5zm3 0h2v2H8zm3 0h2v2h-2zm3 0h2v2h-2zm3 0h2v2h-2zM7 15h10v2H7z"
            : kind === "send"
              ? "M2 21l21-9L2 3v7l15 2-15 2z"
              : "M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11C5.77 20.65 6.31 21 7 21h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM19 15.59 17.59 17 14 13.41 10.41 17 9 15.59 12.59 12 9 8.41 10.41 7 14 10.59 17.59 7 19 8.41 15.41 12z"
        }
      />
    </svg>
  );
}
