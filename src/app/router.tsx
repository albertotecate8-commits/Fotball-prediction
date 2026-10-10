import { createBrowserRouter } from 'react-router'
import { AppShell } from './AppShell'
import { PublicOnly, RequireAdmin, RequireAuth } from './guards'
import { RouteError } from './RouteError'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { LoginPage, SignupPage, ForgotPasswordPage } from '@/features/auth/AuthPages'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { HomePage } from '@/features/home/HomePage'
import { QuinielaPage } from '@/features/quiniela/QuinielaPage'
import { Navigate, useParams } from 'react-router'
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
              { path: '/quinielas', element: <QuinielaPage /> },
              { path: '/quinielas/:roundId', element: <QuinielaPage /> },
              { path: '/quinielas/:roundId/jugar', element: <LegacyPlayRedirect /> },
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
                      { index: true, element: <Navigate to="/admin/jornadas" replace /> },
                      { path: 'participantes', lazy: async () => ({ Component: (await import('@/features/admin/AdminPayments')).AdminPayments }) },
                      { path: 'datos-pago', lazy: async () => ({ Component: (await import('@/features/admin/AdminPaymentInfo')).AdminPaymentInfo }) },
                      { path: 'jornadas', lazy: async () => ({ Component: (await import('@/features/admin/AdminRounds')).AdminRounds }) },
                      { path: 'jornadas/:roundId', lazy: async () => ({ Component: (await import('@/features/admin/AdminRoundEditor')).AdminRoundEditor }) },
                      { path: 'resultados', lazy: async () => ({ Component: (await import('@/features/admin/AdminResults')).AdminResults }) },
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

/** Enlaces antiguos /jugar: la captura vive ahora en Mi quiniela. */
function LegacyPlayRedirect() {
  const { roundId } = useParams()
  return <Navigate to={`/quinielas/${roundId}`} replace />
}
