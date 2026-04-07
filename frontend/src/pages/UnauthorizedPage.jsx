import { Link } from 'react-router-dom';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted">
      <h1 className="text-4xl font-bold mb-2">403</h1>
      <p className="text-muted-foreground mb-6">You don't have permission to access this page.</p>
      <Link
        to="/dashboard"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
