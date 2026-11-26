import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { can, type Permiso } from '../lib/roles';
import { Button, Card, CardBody, Spinner } from './ui';

interface ProtectedRouteProps {
  permiso?: Permiso;
  children: ReactNode;
}

export function ProtectedRoute({ permiso, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner label="Verificando sesión..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (permiso && !can(user.rol, permiso)) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card>
          <CardBody className="flex flex-col items-center text-center py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Acceso restringido</h2>
            <p className="mt-1 text-sm text-slate-500">
              Su rol actual no tiene permisos para acceder a esta sección de la plataforma.
            </p>
            <Link to="/" className="mt-5">
              <Button variant="secondary">Volver al panel</Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
