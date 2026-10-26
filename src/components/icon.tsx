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
  | "check"
  | "chart"
  | "menu"
  | "close"
  | "calendar"
  | "printer"
  | "download"
  | "user"
  | "share"
  | "chat"
  | "phone"
  | "cart"
  | "more"
  | "spark";
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
  chart: "M3 3v18h18M8 17v-5m5 5V8m5 9v-7",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  truck:
    "M1 3h14v13H1V3Zm14 6h4l3 4v3h-7M5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm13 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  check: "M5 13l4 4L19 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
  calendar: "M4 6h16v15H4V6Zm0 5h16M8 3v5m8-5v5",
  printer: "M6 9V3h12v6M6 18H3V9h18v9h-3M6 14h12v7H6v-7Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 21h16",
  share: "M12 15V3m-4 4 4-4 4 4M8 10H5v11h14V10h-3",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
  cart: "M3 4h2.5l2.2 10.5h10.6L20.5 7.5H6.4M9 20.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  more: "M5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm7 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm7 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6",
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
