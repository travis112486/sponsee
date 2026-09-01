// The build script is plain JS (it runs under bare node, before any transpile
// step). This declares the one export src/prerender.test.tsx pulls in.
export declare function injectRoot(html: string, markup: string, label?: string): string;
