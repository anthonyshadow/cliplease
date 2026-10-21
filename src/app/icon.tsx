import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/app-name";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// The first letter of APP_NAME in white on an ink rounded square (04 §4.5), so a rename changes the icon too.
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8, // design-ok: ImageResponse can't read CSS variables
        background: "#111111", // design-ok: ImageResponse can't read CSS variables
        color: "#FFFFFF", // design-ok: ImageResponse can't read CSS variables
        fontSize: 22, // design-ok: ImageResponse can't read CSS variables
      }}
    >
      {APP_NAME.charAt(0)}
    </div>,
    { ...size },
  );
}
