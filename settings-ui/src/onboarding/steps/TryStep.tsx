import type { CSSProperties } from "react";
import { copy } from "../copy";

export function TryStep({ lang }: { lang: string }) {
  const orPress = lang === "id" ? " Atau tekan " : " Or press ";
  return (
    <>
      <h2 className="x">{copy("tryTitle", undefined, lang)}</h2>
      <p className="lead x" style={{ "--i": 1 } as CSSProperties}>
        {copy("trySub", undefined, lang)}
        {orPress}
        <kbd>⌥ N</kbd>.
      </p>
    </>
  );
}
