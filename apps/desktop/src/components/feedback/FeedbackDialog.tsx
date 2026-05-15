import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import "./FeedbackDialog.css";

async function getAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "";
  }
}

async function buildUserAgent(appVer: string): Promise<string> {
  try {
    const os = await import("@tauri-apps/plugin-os");
    const osType = os.type() || "Unknown";
    const osVer = os.version() || "";
    const arch = os.arch() || "";
    return `OpenTemplate/${appVer || "0.0.0"} (${osType} ${osVer}; ${arch})`.replace(/\s+/g, " ").trim();
  } catch {
    return `OpenTemplate/${appVer || "0.0.0"}`;
  }
}

const CATEGORIES = ["general", "bug", "feature"] as const;
type Category = (typeof CATEGORIES)[number];

const SENTIMENTS = [
  { id: "frustrated", emoji: "\u{1F61E}" },
  { id: "neutral", emoji: "\u{1F610}" },
  { id: "happy", emoji: "\u{1F60A}" },
] as const;
type Sentiment = (typeof SENTIMENTS)[number]["id"] | null;

const MAX_CHARS = 5000;
const MIN_CHARS = 10;
const MAX_IMAGES = 3;
const MAX_TOTAL_SIZE = 1024 * 1024; // 1MB

const FEEDBACK_API_URL = "https://open-feedback-studio.pages.dev/api/feedback";
const APP_ID = "open-template";

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const { t } = useTranslation("feedback");
  const { t: tCommon } = useTranslation("common");

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [message, setMessage] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>(null);
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [userAgent, setUserAgent] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setEmail("");
      setFullName("");
      setCategory("general");
      setMessage("");
      setSentiment(null);
      setImages([]);
      setPreviews([]);
      setSubmitting(false);
      setSubmitted(false);
      setError("");

      getAppVersion().then((ver) => {
        setAppVersion(ver);
        buildUserAgent(ver).then(setUserAgent);
      });
    }
  }, [open]);

  // Cleanup preview URLs
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previews]);

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const currentSize = images.reduce((sum, f) => sum + f.size, 0);
    const newImages: File[] = [];
    const newPreviews: string[] = [];

    for (const file of files) {
      if (images.length + newImages.length >= MAX_IMAGES) break;
      if (currentSize + newImages.reduce((s, f) => s + f.size, 0) + file.size > MAX_TOTAL_SIZE) break;
      newImages.push(file);
      newPreviews.push(URL.createObjectURL(file));
    }

    setImages((prev) => [...prev, ...newImages]);
    setPreviews((prev) => [...prev, ...newPreviews]);
    e.target.value = "";
  };

  const handleImageRemove = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleSubmit = async () => {
    if (!isValidEmail(email) || message.trim().length < MIN_CHARS) return;
    setSubmitting(true);
    setError("");

    try {
      const emailVal = email.trim();
      const nameVal = fullName.trim() || undefined;

      const ver = appVersion || undefined;
      const ua = userAgent || undefined;

      const payload: Record<string, string | null | undefined> = {
        app: APP_ID,
        email: emailVal,
        fullname: nameVal,
        category,
        message: message.trim(),
        sentiment,
        appVersion: ver,
      };

      let res: Response;
      if (images.length > 0) {
        const formData = new FormData();
        for (const [key, val] of Object.entries(payload)) {
          if (val != null) formData.append(key, val);
        }
        images.forEach((img) => formData.append("images", img));
        res = await fetch(FEEDBACK_API_URL, {
          method: "POST",
          headers: ua ? { "User-Agent": ua } : {},
          body: formData,
        });
      } else {
        res = await fetch(FEEDBACK_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(ua ? { "User-Agent": ua } : {}) },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSubmitted(true);
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendAnother = () => {
    setEmail("");
    setFullName("");
    setCategory("general");
    setMessage("");
    setSentiment(null);
    setImages([]);
    setPreviews([]);
    setSubmitted(false);
    setError("");
  };

  const canSubmit = isValidEmail(email) && message.trim().length >= MIN_CHARS && !submitting;
  const charCount = message.length;
  const charWarning = charCount >= 4500;

  const footer = !submitted ? (
    <>
      <button className="feedback-btn feedback-btn-secondary" onClick={onClose}>
        {tCommon("cancel")}
      </button>
      <button
        className="feedback-btn feedback-btn-primary"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting ? t("submitting") : t("submit")}
      </button>
    </>
  ) : undefined;

  return (
    <Modal open={open} onClose={onClose} title={t("title")} width={480} className="feedback-dialog" footer={footer}>
      {submitted ? (
        <div className="feedback-success">
          <div className="feedback-success-emoji">{"\u{2705}"}</div>
          <h3>{t("successTitle")}</h3>
          <p>{t("successMessage")}</p>
          <button className="feedback-btn feedback-btn-primary" onClick={handleSendAnother}>
            {t("sendAnother")}
          </button>
        </div>
      ) : (
        <div className="feedback-content">
          {/* Email & Name */}
          <div className="feedback-section">
            <div className="feedback-field-row">
              <label className="feedback-field-label">
                {t("email")} <span className="feedback-required">*</span>
              </label>
              <input
                type="email"
                className="feedback-input"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="feedback-field-row">
              <label className="feedback-field-label">{t("fullName")}</label>
              <input
                type="text"
                className="feedback-input"
                placeholder={t("fullNamePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          <div className="feedback-section">
            <div className="feedback-categories">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  className={`feedback-category${category === cat ? " active" : ""}`}
                  onClick={() => setCategory(cat)}
                >
                  {t(`category${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="feedback-section">
            <textarea
              className="feedback-textarea"
              placeholder={t("messagePlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
              rows={6}
            />
            <div className={`feedback-char-count${charWarning ? " warning" : ""}`}>
              {charCount}/{MAX_CHARS}
            </div>
          </div>

          <div className="feedback-section">
            <div className="feedback-images-row">
              <button
                className="feedback-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                {t("attachImages")}
              </button>
              <span className="feedback-image-limit">{t("imageLimit")}</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={handleImageAdd}
            />
            {previews.length > 0 && (
              <div className="feedback-previews">
                {previews.map((src, i) => (
                  <div key={i} className="feedback-preview">
                    <img src={src} alt="" />
                    <button className="feedback-preview-remove" onClick={() => handleImageRemove(i)}>
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="feedback-section">
            <div className="feedback-sentiment-label">{t("sentiment")}</div>
            <div className="feedback-sentiments">
              {SENTIMENTS.map((s) => (
                <button
                  key={s.id}
                  className={`feedback-sentiment${sentiment === s.id ? " active" : ""}`}
                  onClick={() => setSentiment(sentiment === s.id ? null : s.id)}
                  title={t(`sentiment${s.id.charAt(0).toUpperCase() + s.id.slice(1)}`)}
                >
                  <span className="feedback-sentiment-emoji">{s.emoji}</span>
                  <span className="feedback-sentiment-text">
                    {t(`sentiment${s.id.charAt(0).toUpperCase() + s.id.slice(1)}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="feedback-error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
