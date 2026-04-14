export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  prepTime: number;
  available: boolean;
  stock: number;
  maxStock: number;
  image: string;
  tags: string[];
  modifiers?: string[];
  salesCount: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  items: { menuItem: MenuItem; quantity: number }[];
  status: 'paid' | 'preparing' | 'ready' | 'completed';
  total: number;
  createdAt: Date;
  estimatedPrepTime: number;
  customerName: string;
  type: 'dine-in' | 'takeaway' | 'pickup';
  table?: string;
}

export const categories = ['Food', 'Drinks', 'Desserts', 'Breakfast', 'Bakery', 'Specials'];

export const menuItems: MenuItem[] = [
  { id: '1', name: 'Classic Margherita', description: 'San Marzano tomato, fresh mozzarella, basil, extra virgin olive oil', price: 12.50, category: 'Food', prepTime: 12, available: true, stock: 28, maxStock: 40, image: '🍕', tags: ['vegetarian', 'popular'], salesCount: 142 },
  { id: '2', name: 'Truffle Mushroom Burger', description: 'Angus beef, truffle aioli, gruyère, caramelized onions, brioche bun', price: 16.90, category: 'Food', prepTime: 15, available: true, stock: 18, maxStock: 30, image: '🍔', tags: ['bestseller'], modifiers: ['Extra patty +€4', 'No onions', 'Gluten-free bun +€2'], salesCount: 198 },
  { id: '3', name: 'Caesar Salad', description: 'Romaine hearts, parmesan, anchovy dressing, garlic croutons', price: 10.90, category: 'Food', prepTime: 8, available: true, stock: 5, maxStock: 25, image: '🥗', tags: ['healthy'], salesCount: 87 },
  { id: '4', name: 'Grilled Salmon Bowl', description: 'Atlantic salmon, quinoa, avocado, edamame, miso dressing', price: 18.50, category: 'Food', prepTime: 18, available: true, stock: 12, maxStock: 20, image: '🐟', tags: ['healthy', 'popular'], salesCount: 112 },
  { id: '5', name: 'Pasta Carbonara', description: 'Guanciale, pecorino romano, egg yolk, black pepper, spaghetti', price: 14.90, category: 'Food', prepTime: 14, available: true, stock: 22, maxStock: 30, image: '🍝', tags: ['classic'], salesCount: 156 },
  { id: '6', name: 'Club Sandwich', description: 'Triple-decker, roasted chicken, bacon, lettuce, tomato, herb mayo', price: 11.50, category: 'Food', prepTime: 10, available: true, stock: 3, maxStock: 25, image: '🥪', tags: [], salesCount: 94 },
  { id: '7', name: 'Iced Matcha Latte', description: 'Ceremonial grade matcha, oat milk, light sweetness', price: 5.90, category: 'Drinks', prepTime: 3, available: true, stock: 35, maxStock: 50, image: '🍵', tags: ['popular'], salesCount: 210 },
  { id: '8', name: 'Fresh Orange Juice', description: 'Freshly squeezed Valencia oranges', price: 4.50, category: 'Drinks', prepTime: 2, available: true, stock: 20, maxStock: 40, image: '🍊', tags: [], salesCount: 165 },
  { id: '9', name: 'Flat White', description: 'Double ristretto, velvety steamed milk', price: 4.20, category: 'Drinks', prepTime: 3, available: true, stock: 45, maxStock: 60, image: '☕', tags: ['popular'], salesCount: 278 },
  { id: '10', name: 'Coke Zero', description: 'Ice-cold, 330ml', price: 2.90, category: 'Drinks', prepTime: 1, available: true, stock: 4, maxStock: 48, image: '🥤', tags: [], salesCount: 189 },
  { id: '11', name: 'Tiramisu', description: 'Classic Italian, mascarpone, espresso-soaked ladyfingers, cocoa', price: 8.50, category: 'Desserts', prepTime: 2, available: true, stock: 10, maxStock: 15, image: '🍰', tags: ['bestseller'], salesCount: 134 },
  { id: '12', name: 'Chocolate Fondant', description: 'Warm dark chocolate cake, molten center, vanilla gelato', price: 9.90, category: 'Desserts', prepTime: 14, available: true, stock: 8, maxStock: 12, image: '🍫', tags: ['premium'], salesCount: 98 },
  { id: '13', name: 'Avocado Toast', description: 'Sourdough, smashed avocado, poached eggs, chili flakes, microgreens', price: 11.90, category: 'Breakfast', prepTime: 8, available: true, stock: 15, maxStock: 25, image: '🥑', tags: ['popular', 'vegetarian'], salesCount: 176 },
  { id: '14', name: 'Eggs Benedict', description: 'Poached eggs, smoked ham, hollandaise, English muffin', price: 13.50, category: 'Breakfast', prepTime: 12, available: true, stock: 14, maxStock: 20, image: '🥚', tags: ['classic'], salesCount: 121 },
  { id: '15', name: 'Croissant au Beurre', description: 'Flaky, butter-rich French croissant, served warm', price: 3.90, category: 'Bakery', prepTime: 2, available: true, stock: 22, maxStock: 35, image: '🥐', tags: ['fresh'], salesCount: 245 },
  { id: '16', name: 'Pain au Chocolat', description: 'Dark chocolate filled puff pastry, golden-baked', price: 4.20, category: 'Bakery', prepTime: 2, available: true, stock: 18, maxStock: 30, image: '🍫', tags: ['fresh'], salesCount: 198 },
  { id: '17', name: 'Lobster Risotto', description: 'Arborio rice, lobster tail, saffron, parmesan, white wine reduction', price: 24.90, category: 'Specials', prepTime: 22, available: true, stock: 6, maxStock: 10, image: '🦞', tags: ['premium', 'special'], salesCount: 45 },
  { id: '18', name: 'Wagyu Steak Frites', description: 'A5 wagyu strip, hand-cut fries, béarnaise, grilled asparagus', price: 34.90, category: 'Specials', prepTime: 20, available: false, stock: 0, maxStock: 8, image: '🥩', tags: ['premium', 'special'], salesCount: 32 },
];

const customerNames = ['Alex M.', 'Sophie R.', 'Marco L.', 'Emma K.', 'Luca B.', 'Nina P.', 'Oliver S.', 'Mia T.', 'Felix W.', 'Clara H.'];

export const generateOrders = (): Order[] => {
  const now = new Date();
  return [
    { id: 'o1', orderNumber: 147, items: [{ menuItem: menuItems[1], quantity: 2 }, { menuItem: menuItems[9], quantity: 2 }], status: 'paid', total: 39.60, createdAt: new Date(now.getTime() - 2 * 60000), estimatedPrepTime: 15, customerName: 'Alex M.', type: 'dine-in', table: 'T-4' },
    { id: 'o2', orderNumber: 146, items: [{ menuItem: menuItems[4], quantity: 1 }, { menuItem: menuItems[8], quantity: 1 }], status: 'preparing', total: 19.10, createdAt: new Date(now.getTime() - 8 * 60000), estimatedPrepTime: 14, customerName: 'Sophie R.', type: 'dine-in', table: 'T-7' },
    { id: 'o3', orderNumber: 145, items: [{ menuItem: menuItems[0], quantity: 1 }, { menuItem: menuItems[10], quantity: 1 }, { menuItem: menuItems[7], quantity: 2 }], status: 'preparing', total: 30.40, createdAt: new Date(now.getTime() - 12 * 60000), estimatedPrepTime: 12, customerName: 'Marco L.', type: 'takeaway' },
    { id: 'o4', orderNumber: 144, items: [{ menuItem: menuItems[12], quantity: 2 }, { menuItem: menuItems[8], quantity: 2 }], status: 'ready', total: 32.20, createdAt: new Date(now.getTime() - 18 * 60000), estimatedPrepTime: 8, customerName: 'Emma K.', type: 'pickup' },
    { id: 'o5', orderNumber: 143, items: [{ menuItem: menuItems[3], quantity: 1 }, { menuItem: menuItems[6], quantity: 1 }], status: 'ready', total: 24.40, createdAt: new Date(now.getTime() - 22 * 60000), estimatedPrepTime: 18, customerName: 'Luca B.', type: 'dine-in', table: 'T-2' },
    { id: 'o6', orderNumber: 142, items: [{ menuItem: menuItems[14], quantity: 3 }, { menuItem: menuItems[8], quantity: 1 }], status: 'completed', total: 15.90, createdAt: new Date(now.getTime() - 35 * 60000), estimatedPrepTime: 3, customerName: 'Nina P.', type: 'takeaway' },
    { id: 'o7', orderNumber: 141, items: [{ menuItem: menuItems[13], quantity: 1 }, { menuItem: menuItems[7], quantity: 1 }], status: 'completed', total: 18.00, createdAt: new Date(now.getTime() - 42 * 60000), estimatedPrepTime: 12, customerName: 'Oliver S.', type: 'dine-in', table: 'T-1' },
    { id: 'o8', orderNumber: 140, items: [{ menuItem: menuItems[16], quantity: 1 }, { menuItem: menuItems[6], quantity: 2 }], status: 'completed', total: 36.70, createdAt: new Date(now.getTime() - 55 * 60000), estimatedPrepTime: 22, customerName: 'Mia T.', type: 'dine-in', table: 'T-9' },
  ];
};

export const hourlyOrders = [
  { hour: '08:00', orders: 8, revenue: 124 },
  { hour: '09:00', orders: 15, revenue: 245 },
  { hour: '10:00', orders: 12, revenue: 198 },
  { hour: '11:00', orders: 22, revenue: 387 },
  { hour: '12:00', orders: 38, revenue: 642 },
  { hour: '13:00', orders: 42, revenue: 718 },
  { hour: '14:00', orders: 28, revenue: 456 },
  { hour: '15:00', orders: 14, revenue: 210 },
  { hour: '16:00', orders: 10, revenue: 165 },
  { hour: '17:00', orders: 16, revenue: 278 },
  { hour: '18:00', orders: 32, revenue: 534 },
  { hour: '19:00', orders: 45, revenue: 789 },
  { hour: '20:00', orders: 48, revenue: 842 },
  { hour: '21:00', orders: 35, revenue: 612 },
  { hour: '22:00', orders: 18, revenue: 298 },
];

export const weeklyRevenue = [
  { day: 'Mon', revenue: 2840 },
  { day: 'Tue', revenue: 2650 },
  { day: 'Wed', revenue: 3120 },
  { day: 'Thu', revenue: 3380 },
  { day: 'Fri', revenue: 4210 },
  { day: 'Sat', revenue: 4890 },
  { day: 'Sun', revenue: 3950 },
];

export const orderStatusDistribution = [
  { status: 'Completed', value: 68, fill: 'hsl(160, 84%, 29%)' },
  { status: 'Preparing', value: 15, fill: 'hsl(38, 92%, 50%)' },
  { status: 'Ready', value: 10, fill: 'hsl(210, 100%, 52%)' },
  { status: 'Paid', value: 7, fill: 'hsl(220, 14%, 70%)' },
];

export const aiInsights = [
  { type: 'trend' as const, title: 'Weekend pizza demand is 47% higher than weekday', description: 'Consider pre-prepping more dough on Fridays. Average weekend pizza orders: 62 vs weekday: 42.', priority: 'medium' as const },
  { type: 'warning' as const, title: 'Burger prep slows kitchen between 19:00–21:00', description: 'Burger orders peak at dinner, increasing average kitchen time by 4.2 min. Consider a dedicated burger station.', priority: 'high' as const },
  { type: 'opportunity' as const, title: 'Promote desserts during 15:00–17:00 lull', description: 'Dessert attach rate drops to 8% in afternoon. A combo deal could boost revenue by ~€180/week.', priority: 'medium' as const },
  { type: 'warning' as const, title: 'Low stock risk: Coke Zero & Caesar Salad', description: 'At current sell rate, Coke Zero runs out in ~2 hours, Caesar Salad in ~3 orders. Restock recommended.', priority: 'high' as const },
  { type: 'trend' as const, title: 'Sandwich category: high conversion, low margin', description: 'Club Sandwich converts at 12% but margin is only 34%. Consider a slight price adjustment or smaller portion option.', priority: 'low' as const },
  { type: 'opportunity' as const, title: 'Matcha Latte trending +23% week-over-week', description: 'Fastest growing item. Consider adding a Matcha variant (iced, flavored) to capitalize on demand.', priority: 'medium' as const },
];
