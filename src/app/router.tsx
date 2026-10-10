import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { PublicOnly, RequireAdmin, RequireAuth } from './guards'
import { RouteError } from './RouteError'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { LoginPage, SignupPage, ForgotPasswordPage } from '@/features/auth/AuthPages'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { HomePage } from '@/features/home/HomePage'
import { RoundsPage } from '@/features/rounds/RoundsPage'
import { RoundResultsPage } from '@/features/rounds/RoundResultsPage'
import { PredictionPage } from '@/features/predictions/PredictionPage'
import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage'
import { ProfilePage } from '@/features/profile/ProfilePage'

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: '/entrar', element: <LoginPage /> },
          { path: '/registro', element: <SignupPage /> },
          { path: '/recuperar', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '/restablecer', element: <ResetPasswordPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/', element: <HomePage /> },
              { path: '/quinielas', element: <RoundsPage /> },
              { path: '/quinielas/:roundId', element: <RoundResultsPage /> },
              { path: '/quinielas/:roundId/jugar', element: <PredictionPage /> },
              { path: '/clasificacion', element: <LeaderboardPage /> },
              { path: '/perfil', element: <ProfilePage /> },
              {
                element: <RequireAdmin />,
                children: [
                  {
                    // El panel admin se descarga solo cuando un admin lo abre.
                    path: '/admin',
                    lazy: async () => ({ Component: (await import('@/features/admin/AdminLayout')).AdminLayout }),
                    hydrateFallbackElement: <FullPageSpinner />,
                    children: [
                      { index: true, lazy: async () => ({ Component: (await import('@/features/admin/AdminDashboard')).AdminDashboard }) },
                      { path: 'participantes', lazy: async () => ({ Component: (await import('@/features/admin/AdminParticipants')).AdminParticipants }) },
                      { path: 'grupos', lazy: async () => ({ Component: (await import('@/features/admin/AdminGroups')).AdminGroups }) },
                      { path: 'jornadas', lazy: async () => ({ Component: (await import('@/features/admin/AdminRounds')).AdminRounds }) },
                      { path: 'jornadas/:roundId', lazy: async () => ({ Component: (await import('@/features/admin/AdminRoundEditor')).AdminRoundEditor }) },
                      { path: 'resultados', lazy: async () => ({ Component: (await import('@/features/admin/AdminResults')).AdminResults }) },
                      { path: 'auditoria', lazy: async () => ({ Component: (await import('@/features/admin/AdminAudit')).AdminAudit }) },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })
