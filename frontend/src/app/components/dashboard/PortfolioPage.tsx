import { useLang } from "../LanguageContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { UnderConstruction } from "../shared/UnderConstruction";

export function PortfolioPage() {
  const { t } = useLang();
  useDocumentTitle(t("dash.nav.portfolio"));
  return <UnderConstruction featureName={t("dash.nav.portfolio")} />;
}
