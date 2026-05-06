import React from 'react'
import { ArrowUpRight, Building2 } from 'lucide-react'
import mustLogo from '../../../images/logo.png'

interface AuthShellProps {
  title: string
  subtitle: string
  footerPrompt: React.ReactNode
  children: React.ReactNode
}

const AuthShell: React.FC<AuthShellProps> = ({ title, subtitle, footerPrompt, children }) => {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fbfcfe_0%,#eef3fa_100%)]">
      <div className="grid min-h-screen lg:grid-cols-[28%_72%]">
        <aside className="relative hidden overflow-hidden bg-[linear-gradient(180deg,#18204f_0%,#25306f_54%,#2c348f_100%)] text-white lg:flex lg:flex-col">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.1),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(244,182,39,0.18),transparent_26%),radial-gradient(circle_at_30%_80%,rgba(47,148,76,0.18),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0))]" />
          <div className="absolute -left-20 top-24 h-64 w-64 rounded-full border border-white/10" />
          <div className="absolute right-[-72px] top-[34%] h-44 w-44 rounded-full bg-white/6 blur-2xl" />
          <div className="absolute bottom-10 left-10 h-24 w-[72%] rounded-full bg-gradient-to-r from-white/0 via-white/10 to-white/0 blur-xl" />
          <div className="relative z-10 flex h-full flex-col px-8 py-10 xl:px-10 xl:py-12">
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-white/10 shadow-[0_18px_45px_rgba(8,15,40,0.35)] backdrop-blur">
                <Building2 className="h-8 w-8" />
              </div>
              <div>
                <p className="text-[2.1rem] font-semibold tracking-[-0.04em] text-white/95">ArASSIST</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.28em] text-white/64">
                  Academic Support Platform
                </p>
              </div>
            </div>

            <div className="mt-28">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/68">
                <span>MUST</span>
                <span className="h-1 w-1 rounded-full bg-emerald-300/80" />
                <span>Registrar Access</span>
              </div>
              <h1 className="mt-6 max-w-[12ch] font-serif text-[clamp(2.5rem,3.2vw,3.8rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-white">
                Clear access to academic support.
              </h1>
            </div>

            <div className="mt-auto border-t border-white/12 pt-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-white/12 shadow-lg">
                    <img src={mustLogo} alt="" aria-hidden="true" className="h-10 w-10 object-contain" />
                  </div>
                  <div>
                    <p className="text-base font-medium text-white/90">Mbarara University of Science and Technology</p>
                    <p className="mt-1 text-sm italic text-emerald-200/80">"Succeed We Must"</p>
                  </div>
                </div>
                <ArrowUpRight className="h-5 w-5 text-white/45" />
              </div>
            </div>
          </div>
        </aside>

        <main className="relative flex items-center justify-center overflow-hidden px-6 py-8 sm:px-8 lg:px-12 xl:px-20">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <img
              src={mustLogo}
              alt=""
              aria-hidden="true"
              className="hidden w-[360px] max-w-[42vw] rotate-[-10deg] opacity-[0.06] grayscale lg:block xl:w-[440px]"
            />
          </div>

          <div className="pointer-events-none absolute right-8 top-12 hidden h-32 w-32 rounded-full bg-primary-200/40 blur-3xl lg:block" />
          <div className="pointer-events-none absolute left-[18%] top-[18%] hidden h-28 w-28 rounded-full bg-emerald-200/35 blur-3xl lg:block" />
          <div className="pointer-events-none absolute bottom-10 left-10 hidden h-32 w-32 rounded-full bg-amber-200/50 blur-3xl lg:block" />

          <div className="relative z-10 w-full max-w-2xl">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-lg">
                  <img src={mustLogo} alt="" aria-hidden="true" className="h-7 w-7 object-contain" />
                </div>
                <div>
                  <p className="text-2xl font-semibold text-primary-700">ArASSIST</p>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Academic Support Platform
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="eyebrow-label">Secure access</p>
              <h2 className="display-title mt-3 text-slate-950">
                {title}
              </h2>
              <p className="mt-2 text-base leading-7 text-slate-600 sm:text-lg">{subtitle}</p>
            </div>

            <div className="mt-8 rounded-[2rem] border border-white/80 bg-white/84 p-5 shadow-[0_28px_70px_rgba(15,23,42,0.12)] backdrop-blur-xl sm:p-7 lg:p-8">
              {children}
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6 text-center">
              {footerPrompt}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default AuthShell
