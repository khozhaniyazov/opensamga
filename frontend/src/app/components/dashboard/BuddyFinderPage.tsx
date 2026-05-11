import { useLang } from "../LanguageContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { UnderConstruction } from "../shared/UnderConstruction";

export function BuddyFinderPage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.buddy"));
  return <UnderConstruction featureName={t("dash.nav.buddy")} />;
}
