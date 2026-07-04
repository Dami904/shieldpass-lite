import { useState } from "react"
import { Icons } from "./icons"
import { Button } from "./button"
import { Input } from "./input"
import { Label } from "./label"
import { Link } from "react-router-dom"

function StackedCircularFooter() {
  const [email, setEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)

  function handleSubscribe(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    // No newsletter backend yet — acknowledge locally so the button isn't a dead reload.
    setSubscribed(true)
    setEmail("")
  }

  return (
    <footer className="w-full border-t border-white/5 bg-[#0c1117] py-12 mt-20 relative z-10 pointer-events-auto">
      <div className="w-full px-6 md:px-12">
        <div className="flex flex-col items-center">
          <div className="mb-8 rounded-full bg-white/[0.08] p-8 border border-white/10">
            <Icons.logo className="text-white w-8 h-8" />
          </div>
          <nav className="mb-8 flex flex-wrap justify-center gap-6">
            <Link to="/" className="text-white/70 hover:text-white transition-colors">Home</Link>
            <Link to="/about" className="text-white/70 hover:text-white transition-colors">About</Link>
            <Link to="/docs" className="text-white/70 hover:text-white transition-colors">Docs</Link>
          </nav>
          <div className="mb-8 flex space-x-4">
            <a href="https://github.com/Xyrelix/ShieldPass" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="icon" className="rounded-full bg-white/5 border-white/10 text-white hover:bg-white/10">
                <Icons.gitHub className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </Button>
            </a>
            <a href="https://x.com/ShieldPass" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="icon" className="rounded-full bg-white/5 border-white/10 text-white hover:bg-white/10">
                <Icons.twitter className="h-4 w-4" />
                <span className="sr-only">X (Twitter)</span>
              </Button>
            </a>
          </div>
          <div className="mb-8 w-full max-w-xl">
            {subscribed ? (
              <p className="text-center text-sm text-emerald-400 font-light">Thanks — you're on the list.</p>
            ) : (
              <form className="flex space-x-2" onSubmit={handleSubscribe}>
                <div className="flex-grow">
                  <Label htmlFor="email" className="sr-only">Email</Label>
                  <Input
                    id="email"
                    placeholder="Subscribe to ShieldPass updates"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-full bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-white/20"
                  />
                </div>
                <Button type="submit" className="rounded-full bg-black text-white border border-white/20 hover:bg-white/10">
                  Subscribe
                </Button>
              </form>
            )}
          </div>
          <div className="text-center">
            <p className="text-sm text-white/50 font-light">
              © 2026 ShieldPass. All rights reserved. Zero-Knowledge P2P Trading on Stellar.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}

export { StackedCircularFooter }
