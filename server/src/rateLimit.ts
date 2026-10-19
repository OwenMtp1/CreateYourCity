/** Seau à jetons : limite les commandes abusives par connexion. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly ratePerSec: number, private readonly burst: number, now = Date.now()) {
    this.tokens = burst;
    this.last = now;
  }

  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
