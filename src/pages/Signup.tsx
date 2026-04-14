import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChefHat, ArrowRight, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { toast } from 'sonner';

const BUSINESS_TYPES = ['Restaurant', 'Café', 'Bakery', 'Pastry Shop', 'Fast Food', 'Bar & Lounge', 'Food Truck'];

interface FormState {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessType: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  businessName?: string;
  businessType?: string;
  general?: string;
}

export default function Signup() {
  const navigate = useNavigate();
  const signup = useStore(s => s.signup);

  const [form, setForm] = useState<FormState>({ name: '', email: '', password: '', businessName: '', businessType: '' });
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);

  const update = (key: keyof FormState, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const validate = (): FormErrors => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = 'Full name is required.';
    if (!form.email.trim()) e.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address.';
    if (!form.password) e.password = 'Password is required.';
    else if (form.password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (!form.businessName.trim()) e.businessName = 'Business name is required.';
    if (!form.businessType) e.businessType = 'Please select a business type.';
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    const result = await signup({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      name: form.name.trim(),
      businessName: form.businessName.trim(),
    });
    setLoading(false);
    if (result.success) {
      toast.success('Account created! Welcome to SmartLine.');
      navigate('/dashboard');
    } else {
      setErrors({ general: result.error });
    }
  };

  const field = (id: keyof FormState) => `w-full h-11 px-3.5 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors ${errors[id] ? 'border-destructive' : 'border-input'}`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <ChefHat className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-xl">SmartLine</span>
        </div>

        <h2 className="font-display text-2xl font-bold mb-1">Create your account</h2>
        <p className="text-muted-foreground mb-8">Start optimizing your operations in minutes</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block" htmlFor="name">Full name</label>
              <input id="name" type="text" value={form.name} onChange={e => update('name', e.target.value)} placeholder="Jane Doe" className={field('name')} autoComplete="name" />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block" htmlFor="email">Email</label>
              <input id="email" type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@business.com" className={field('email')} autoComplete="email" />
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block" htmlFor="password">Password</label>
            <div className="relative">
              <input id="password" type={showPw ? 'text' : 'password'} value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min. 8 characters" className={field('password')} autoComplete="new-password" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block" htmlFor="businessName">Business name</label>
            <input id="businessName" type="text" value={form.businessName} onChange={e => update('businessName', e.target.value)} placeholder="My Restaurant" className={field('businessName')} />
            {errors.businessName && <p className="text-xs text-destructive mt-1">{errors.businessName}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block" htmlFor="businessType">Business type</label>
            <select id="businessType" value={form.businessType} onChange={e => update('businessType', e.target.value)} className={field('businessType')}>
              <option value="">Select type…</option>
              {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.businessType && <p className="text-xs text-destructive mt-1">{errors.businessType}</p>}
          </div>

          {errors.general && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errors.general}
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full h-11 bg-primary text-primary-foreground rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-60">
            {loading ? 'Creating account…' : <>Create account <ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{' '}
          <Link to="/" className="text-primary font-medium hover:underline">Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}
