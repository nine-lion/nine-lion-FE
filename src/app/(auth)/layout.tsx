export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-background px-6 py-12 sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgb(124_58_237/0.12),transparent_46%),radial-gradient(ellipse_at_bottom_right,rgb(99_102_241/0.1),transparent_50%)]"
      />
      <div className="relative z-10 grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <section className="flex flex-col gap-5 lg:gap-6">
          <p className="text-sm font-bold tracking-[0.18em] text-primary">
            새 목표
          </p>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-[2.75rem] lg:leading-tight">
            시험일까지,
            <br />
            할 일을 선명하게.
          </h1>
          <p className="max-w-md text-body leading-7 text-muted">
            시험과 범위를 적으면 실행 가능한 공부 목표의 시작점이
            만들어집니다.
          </p>
        </section>
        <div className="w-full max-w-105 justify-self-center lg:justify-self-end">
          {children}
        </div>
      </div>
    </div>
  );
}
