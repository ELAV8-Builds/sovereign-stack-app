interface DoneStepProps {
  onFinish: () => void;
}

export function DoneStep({ onFinish }: DoneStepProps) {
  return (
    <div className="text-center space-y-6 animate-fadeIn py-4">
      <div className="text-5xl animate-scaleIn">✨</div>
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">
          You're all set!
        </h2>
        <p className="text-slate-400 text-sm">
          Your agent is ready to chat. Ask it anything.
        </p>
      </div>

      <button
        onClick={onFinish}
        className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl text-white font-semibold transition-all duration-200 shadow-lg shadow-blue-600/20 active:scale-[0.98]"
      >
        Start Chatting &rarr;
      </button>
    </div>
  );
}
