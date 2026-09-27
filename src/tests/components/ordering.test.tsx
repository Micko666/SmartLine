import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderPortal from '@/pages/customer/OrderPortal';
import Menu from '@/pages/customer/Menu';
import Receipt from '@/pages/customer/Receipt';
import { useStore } from '@/store';
import { DEFAULT_SETTINGS as initialSettings, SEED_MENU_ITEMS as initialMenuItems, SEED_TABLES as initialTables } from '@/domain/initialData';
const allDays = Array.from({length:7}, (_,day) => ({dayOfWeek: day as 0|1|2|3|4|5|6, isOpen:true, openTime:'00:00', closeTime:'23:59'}));
function renderAt(path: string) { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/order/:restaurantToken" element={<OrderPortal/>}/><Route path="/menu" element={<Menu/>}/><Route path="/receipt/:receiptId" element={<Receipt/>}/></Routes></MemoryRouter>); }
beforeEach(() => {
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
  localStorage.clear(); sessionStorage.clear();
  useStore.setState({_hasHydrated:true, settings:{...initialSettings, restaurantToken:'test', timezone:'Europe/Podgorica', orderingPaused:false, takeawayEnabled:true, deliveryEnabled:true, businessHours:allDays}, menuItems:initialMenuItems, tables:initialTables, orders:[], receipts:[], reservations:[]});
});
afterEach(() => {cleanup();vi.useRealTimers();});
describe('customer ordering routes', () => {
  it.each(['Takeaway','Delivery'])('renders %s schedule without ReferenceError', async mode => {
    renderAt('/order/test'); fireEvent.click(await screen.findByRole('button',{name:new RegExp(mode)}));
    expect(screen.getByText('Showing times at least 30 min from now')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('12:30');
  });
  it.each(['takeawayEnabled','deliveryEnabled'] as const)('disables %s', async field => {
    useStore.setState(s=>({settings:{...s.settings,[field]:false}})); renderAt('/order/test');
    expect(await screen.findByRole('button',{name:new RegExp(field === 'takeawayEnabled' ? 'Takeaway' : 'Delivery')})).toBeDisabled();
  });
  it('shows closed status', async () => {
    useStore.setState(s=>({settings:{...s.settings,businessHours:allDays.map(d=>({...d,isOpen:false}))}})); renderAt('/order/test');
    expect(await screen.findByText(/closed right now/)).toBeInTheDocument();
  });
  it('blocks paused QR menu before cart', () => {
    useStore.setState(s=>({settings:{...s.settings,orderingPaused:true}})); renderAt('/menu?t='+initialTables[0].id+'&r=test');
    expect(screen.getByText('Orders paused')).toBeInTheDocument();
  });
  it('opens dine-in only for a known table QR', () => {
    renderAt('/menu?t='+initialTables[0].id+'&r=test'); expect(screen.queryByText(/scan the QR code/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();
  });
  it('revalidates direct schedule URLs and does not offer closed slots', () => {
    renderAt('/menu?mode=takeaway&r=test&date=2020-01-01&time=12:00');
    expect(screen.getByText('When would you like to pick up?')).toBeInTheDocument();
  });
  it('does not offer a dead generic dine-in link', () => {
    renderAt('/menu?r=test'); expect(screen.queryByRole('button',{name:/Dine In/})).not.toBeInTheDocument();
    expect(screen.getByText(/scan your table QR/)).toBeInTheDocument();
  });
});
