type KotlinLogoProps = {
  className?: string;
  label?: boolean;
};

export function KotlinLogo({ className = "", label = true }: KotlinLogoProps) {
  return (
    <div className={`kotlin-logo-wrap ${className}`}>
      <span className="kotlin-logo" aria-hidden="true" />
      {label ? <span className="sr-only">Kotlin</span> : null}
    </div>
  );
}
