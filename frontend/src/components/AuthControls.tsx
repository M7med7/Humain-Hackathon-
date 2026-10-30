import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

// Top-corner controls for the signed-out pages, in the same order as the app header.
export function AuthControls() {
  return (
    <div className="absolute top-6 end-6 flex items-center gap-2.5">
      <LanguageSwitcher />
      <ThemeToggle />
    </div>
  );
}
