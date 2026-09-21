// biome-ignore-all lint/security/noDangerouslySetInnerHtml: only trusted build-time local SVG paths are inserted
import { readFile } from "node:fs/promises";
import path from "node:path";
import TramApp from "@/components/tram-app";

export default async function Home() {
  const source = await readFile(
    path.join(process.cwd(), "public/tram-network.svg"),
    "utf8",
  );
  const paths = source.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  // Local, generated SVG paths only; no user-supplied markup enters this boundary.
  return (
    <TramApp
      network={
        <g
          className="network-lines"
          fillRule="evenodd"
          dangerouslySetInnerHTML={{ __html: paths }}
        />
      }
    />
  );
}
