export type IconName =
  | "home"
  | "people"
  | "box"
  | "wallet"
  | "file"
  | "settings"
  | "camera"
  | "plus"
  | "arrow"
  | "truck"
  | "check";
const paths: Record<IconName, string> = {
  home: "M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm11 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  box: "m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v9M7 5.8l10 5.5",
  wallet: "M20 8V5H4a2 2 0 0 0 0 4h17v11H4a2 2 0 0 1-2-2V7m19 6h-6v4h6",
  file: "M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  camera: "M3 7h4l2-3h6l2 3h4v14H3V7Zm9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  truck:
    "M1 3h14v13H1V3Zm14 6h4l3 4v3h-7M5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm13 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  check: "M5 13l4 4L19 7",
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
