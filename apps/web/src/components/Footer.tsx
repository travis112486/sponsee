export default function Footer() {
  return (
    <footer className="mt-12 border-t border-hairline py-6 text-[11px] text-ink-3">
      <div className="flex items-center justify-between">
        <p>© {new Date().getFullYear()} Sponsee. All rights reserved.</p>
        <div className="flex gap-4">
          <a href="#" className="hover:text-ink-2">Privacy</a>
          <a href="#" className="hover:text-ink-2">Terms</a>
          <a href="#" className="hover:text-ink-2">Support</a>
        </div>
      </div>
    </footer>
  );
}
