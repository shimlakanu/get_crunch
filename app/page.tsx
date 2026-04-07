export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-black">
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .thanks-text {
          animation: fadeInUp 1s ease forwards, shimmer 4s ease-in-out 1s infinite;
        }
      `}</style>
      <p className="thanks-text text-6xl font-light tracking-widest text-zinc-800 dark:text-zinc-200 select-none">
        thanks tori
      </p>
    </div>
  );
}
