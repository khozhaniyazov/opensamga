import { Construction, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { useLang } from "../LanguageContext";

interface Props {
  featureName: string;
}

export function UnderConstruction({ featureName }: Props) {
  const navigate = useNavigate();
  const { t } = useLang();

  return (
    <div className="max-w-md mx-auto text-center py-16">
      <div className="w-14 h-14 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center mx-auto mb-5">
        <Construction size={24} className="text-amber-600" />
      </div>
      <h2
        className="text-zinc-800 mb-1.5"
        style={{ fontSize: 20, fontWeight: 700 }}
      >
        {featureName}
      </h2>
      <p
        className="text-zinc-500 mb-6"
        style={{ fontSize: 14, lineHeight: 1.7 }}
      >
        {t("uc.desc")}
      </p>
      <button
        onClick={() => navigate("/dashboard")}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-zinc-200 text-zinc-500 hover:text-zinc-700 hover:border-zinc-300 transition-colors"
        style={{ fontSize: 14, fontWeight: 500 }}
      >
        <ArrowLeft size={16} />
        {t("uc.back")}
      </button>
    </div>
  );
}
