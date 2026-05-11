import { useLang } from "../LanguageContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { UnderConstruction } from "../shared/UnderConstruction";

export function CommuterPage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.commuter"));
  return <UnderConstruction featureName={t("dash.nav.commuter")} />;
}
