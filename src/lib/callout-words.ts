/** Callouts are written by strangers and the model can read this machine's files, so raw posts never reach it. Only runs
 * of words from this list do: everyday and trading words, and nothing that could name a file, a secret or a command. */
import type { Callout } from "./agent-trader.ts";

const WORDS = new Set(`website wallet wallets posting posts posted main gamble gambling gambled x fly a about after again against all almost already also always am an and another any are around as at away back bad be because been before behind being best better big bit both but by came can cant cause come coming could day days did didnt do does doesnt doing done dont down each early easy else enough even ever every everyone everything far feel feels few first for forever free from full get gets getting give go goes going gone good got great had happen has have he heard her here high him his hold how huge i if im in into is isnt it its ive just keep kind know last late later less let like likely little live long look looking looks lol lot lots love low made make makes many may maybe me mean might mine miss more most much my need needs never new next nice no not nothing now of off oh ok okay old on once one only or other our out over own people pretty put quite real really right same see seems seen she since small so some someone something soon still such sure take taking than that thats the their them then there these they thing things think this those though thought three through time to today together tomorrow tonight too took top try two under until up us very wait want wanted was watch way we week well went were what when where which while who why will with without wont would wow yeah year years yes yet you youre
ai agent animal animals ape aped apes art artist ath attention bag bags base bear bearish bears believe believer believers bid bids bonded bonding bottom breakout brand build builder builders building built bull bullish bulls burn burned buy buyer buyers buying buys call called caller callers calling calls cap cat chad chads chart charts chain cheap community comeback conviction cook cooked cooking creator creators crazy culture cto cult cute cycle dao degen degens deploy deployer dev devs dip dips dog dogs doxxed dump dumped dumping eco ecosystem entry exit fair fees fomo food founder fun fund game games gaming gem gems giga green growth gains gain hands holder holders holding hype idea insane insanely insider insiders jeet jeeted jeets launch launched launchpad launching lead leader liquidity lore loss losses low mc mcap meme memes memecoin memecoin memecoins meta migrate migrated milly million millions mint mints momentum moon mooning narrative news og pair paid pay pays peak pfp pivot play plays position power presale price product profit profits project pump pumped pumping pumps rally rare raid red revenue rewards rich risk roadmap robot rotation rug rugged rugs run runner running safe scam scammed scams season sell seller sellers selling sells send sending sent sentiment shill short site sniped snipers social socials solana sol sold stream streamer streaming strong stock stocks story supply support team tech thesis ticker token tokens trade trader traders trading trend trending trenches twitter undervalued utility value viral volume vibe vibes volatile weak whale whales win winner winning wins`.split(/\s+/));
/** A $ticker names a coin: letters only and short, so it cannot spell a path, a key or a command. */
const allowed = (w: string) => WORDS.has(w) || /^\$?\d+(\.\d+)?[kmx%]?$/.test(w) || /^\$[a-z]{2,10}$/.test(w);

/** Each poster's runs of three or more allowed words, biggest position first. Anything else on the page stays behind. */
export function safeQuotes(posts: Callout[], max = 8) {
  const out: string[] = [];
  for (const p of [...posts].sort((a, b) => (b.positionUsd ?? 0) - (a.positionUsd ?? 0))) {
    const runs: string[] = []; let run: string[] = [];
    for (const w of [...p.body.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9$.%]+/), ""]) {
      const word = w.replace(/\.+$/, "");
      if (word && allowed(word)) run.push(word); else { if (run.length >= 3) runs.push(run.join(" ")); run = []; }
    }
    const quote = runs.join(" ... ").split(" ").slice(0, 24).join(" ");
    if (quote && !out.includes(quote)) out.push(quote);
    if (out.length >= max) break;
  }
  return out;
}
