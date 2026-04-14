import type { MenuItem, Table, BusinessSettings, User, Ingredient } from './types';

/** Deterministic ID generator for seed data only. */
const seed = (n: number) => `seed-${n}`;

export const SEED_CATEGORIES = ['Food', 'Drinks', 'Desserts', 'Breakfast', 'Bakery', 'Specials'];

export const SEED_MENU_ITEMS: MenuItem[] = [
  { id: seed(1), name: 'Classic Margherita', description: 'San Marzano tomato, fresh mozzarella, basil, extra virgin olive oil', price: 12.50, category: 'Food', prepTime: 12, stock: 28, maxStock: 40, status: 'active', icon: '🍕', imageUrl: '', thumbnailUrl: '', tags: ['vegetarian', 'popular'], allergens: ['gluten', 'dairy'], dietaryTags: ['vegetarian'], calories: 680, costPerServing: 3.20, recipe: [], modifiers: [], sortOrder: 1, salesCount: 142, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(2), name: 'Truffle Mushroom Burger', description: 'Angus beef, truffle aioli, gruyère, caramelized onions, brioche bun', price: 16.90, category: 'Food', prepTime: 15, stock: 18, maxStock: 30, status: 'active', icon: '🍔', imageUrl: '', thumbnailUrl: '', tags: ['bestseller'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: [], calories: 920, costPerServing: 6.50, recipe: [], modifiers: [{ id: 'mod-1', name: 'Extras', required: false, maxSelections: 2, options: [{ id: 'opt-1', name: 'Extra patty', priceAdjustment: 4.00 }, { id: 'opt-2', name: 'No onions', priceAdjustment: 0 }, { id: 'opt-3', name: 'Gluten-free bun', priceAdjustment: 2.00 }] }], sortOrder: 2, salesCount: 198, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(3), name: 'Caesar Salad', description: 'Romaine hearts, parmesan, anchovy dressing, garlic croutons', price: 10.90, category: 'Food', prepTime: 8, stock: 5, maxStock: 25, status: 'active', icon: '🥗', imageUrl: '', thumbnailUrl: '', tags: ['healthy'], allergens: ['gluten', 'dairy', 'fish', 'eggs'], dietaryTags: [], calories: 340, costPerServing: 2.40, recipe: [], modifiers: [], sortOrder: 3, salesCount: 87, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(4), name: 'Grilled Salmon Bowl', description: 'Atlantic salmon, quinoa, avocado, edamame, miso dressing', price: 18.50, category: 'Food', prepTime: 18, stock: 12, maxStock: 20, status: 'active', icon: '🐟', imageUrl: '', thumbnailUrl: '', tags: ['healthy', 'popular'], allergens: ['fish', 'soy'], dietaryTags: ['gluten-free', 'dairy-free'], calories: 520, costPerServing: 7.80, recipe: [], modifiers: [], sortOrder: 4, salesCount: 112, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(5), name: 'Pasta Carbonara', description: 'Guanciale, pecorino romano, egg yolk, black pepper, spaghetti', price: 14.90, category: 'Food', prepTime: 14, stock: 22, maxStock: 30, status: 'active', icon: '🍝', imageUrl: '', thumbnailUrl: '', tags: ['classic'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: [], calories: 780, costPerServing: 4.20, recipe: [], modifiers: [], sortOrder: 5, salesCount: 156, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(6), name: 'Club Sandwich', description: 'Triple-decker, roasted chicken, bacon, lettuce, tomato, herb mayo', price: 11.50, category: 'Food', prepTime: 10, stock: 3, maxStock: 25, status: 'active', icon: '🥪', imageUrl: '', thumbnailUrl: '', tags: [], allergens: ['gluten', 'eggs'], dietaryTags: [], calories: 620, costPerServing: 3.80, recipe: [], modifiers: [], sortOrder: 6, salesCount: 94, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(7), name: 'Iced Matcha Latte', description: 'Ceremonial grade matcha, oat milk, light sweetness', price: 5.90, category: 'Drinks', prepTime: 3, stock: 35, maxStock: 50, status: 'active', icon: '🍵', imageUrl: '', thumbnailUrl: '', tags: ['popular'], allergens: [], dietaryTags: ['vegan', 'gluten-free', 'dairy-free'], calories: 180, costPerServing: 1.20, recipe: [], modifiers: [{ id: 'mod-2', name: 'Milk', required: false, maxSelections: 1, options: [{ id: 'opt-4', name: 'Oat milk', priceAdjustment: 0 }, { id: 'opt-5', name: 'Almond milk', priceAdjustment: 0.50 }, { id: 'opt-6', name: 'Full cream', priceAdjustment: 0 }] }], sortOrder: 7, salesCount: 210, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(8), name: 'Fresh Orange Juice', description: 'Freshly squeezed Valencia oranges', price: 4.50, category: 'Drinks', prepTime: 2, stock: 20, maxStock: 40, status: 'active', icon: '🍊', imageUrl: '', thumbnailUrl: '', tags: [], allergens: [], dietaryTags: ['vegan', 'gluten-free', 'dairy-free'], calories: 110, costPerServing: 0.90, recipe: [], modifiers: [], sortOrder: 8, salesCount: 165, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(9), name: 'Flat White', description: 'Double ristretto, velvety steamed milk', price: 4.20, category: 'Drinks', prepTime: 3, stock: 45, maxStock: 60, status: 'active', icon: '☕', imageUrl: '', thumbnailUrl: '', tags: ['popular'], allergens: ['dairy'], dietaryTags: ['vegetarian', 'gluten-free'], calories: 120, costPerServing: 0.70, recipe: [], modifiers: [], sortOrder: 9, salesCount: 278, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(10), name: 'Coke Zero', description: 'Ice-cold, 330ml', price: 2.90, category: 'Drinks', prepTime: 1, stock: 4, maxStock: 48, status: 'active', icon: '🥤', imageUrl: '', thumbnailUrl: '', tags: [], allergens: [], dietaryTags: ['vegan', 'gluten-free', 'dairy-free'], calories: 0, costPerServing: 0.50, recipe: [], modifiers: [], sortOrder: 10, salesCount: 189, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(11), name: 'Tiramisu', description: 'Classic Italian, mascarpone, espresso-soaked ladyfingers, cocoa', price: 8.50, category: 'Desserts', prepTime: 2, stock: 10, maxStock: 15, status: 'active', icon: '🍰', imageUrl: '', thumbnailUrl: '', tags: ['bestseller'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: ['vegetarian'], calories: 380, costPerServing: 1.80, recipe: [], modifiers: [], sortOrder: 11, salesCount: 134, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(12), name: 'Chocolate Fondant', description: 'Warm dark chocolate cake, molten center, vanilla gelato', price: 9.90, category: 'Desserts', prepTime: 14, stock: 8, maxStock: 12, status: 'active', icon: '🍫', imageUrl: '', thumbnailUrl: '', tags: ['premium'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: ['vegetarian'], calories: 450, costPerServing: 2.20, recipe: [], modifiers: [], sortOrder: 12, salesCount: 98, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(13), name: 'Avocado Toast', description: 'Sourdough, smashed avocado, poached eggs, chili flakes, microgreens', price: 11.90, category: 'Breakfast', prepTime: 8, stock: 15, maxStock: 25, status: 'active', icon: '🥑', imageUrl: '', thumbnailUrl: '', tags: ['popular', 'vegetarian'], allergens: ['gluten', 'eggs'], dietaryTags: ['vegetarian'], calories: 410, costPerServing: 2.60, recipe: [], modifiers: [], sortOrder: 13, salesCount: 176, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(14), name: 'Eggs Benedict', description: 'Poached eggs, smoked ham, hollandaise, English muffin', price: 13.50, category: 'Breakfast', prepTime: 12, stock: 14, maxStock: 20, status: 'active', icon: '🥚', imageUrl: '', thumbnailUrl: '', tags: ['classic'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: [], calories: 560, costPerServing: 3.90, recipe: [], modifiers: [], sortOrder: 14, salesCount: 121, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(15), name: 'Croissant au Beurre', description: 'Flaky, butter-rich French croissant, served warm', price: 3.90, category: 'Bakery', prepTime: 2, stock: 22, maxStock: 35, status: 'active', icon: '🥐', imageUrl: '', thumbnailUrl: '', tags: ['fresh'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: ['vegetarian'], calories: 280, costPerServing: 0.80, recipe: [], modifiers: [], sortOrder: 15, salesCount: 245, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(16), name: 'Pain au Chocolat', description: 'Dark chocolate filled puff pastry, golden-baked', price: 4.20, category: 'Bakery', prepTime: 2, stock: 18, maxStock: 30, status: 'active', icon: '🍫', imageUrl: '', thumbnailUrl: '', tags: ['fresh'], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: ['vegetarian'], calories: 310, costPerServing: 0.90, recipe: [], modifiers: [], sortOrder: 16, salesCount: 198, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(17), name: 'Lobster Risotto', description: 'Arborio rice, lobster tail, saffron, parmesan, white wine reduction', price: 24.90, category: 'Specials', prepTime: 22, stock: 6, maxStock: 10, status: 'active', icon: '🦞', imageUrl: '', thumbnailUrl: '', tags: ['premium', 'special'], allergens: ['dairy', 'shellfish'], dietaryTags: ['gluten-free'], calories: 640, costPerServing: 11.50, recipe: [], modifiers: [], sortOrder: 17, salesCount: 45, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: seed(18), name: 'Wagyu Steak Frites', description: 'A5 wagyu strip, hand-cut fries, béarnaise, grilled asparagus', price: 34.90, category: 'Specials', prepTime: 20, stock: 0, maxStock: 8, status: 'disabled', icon: '🥩', imageUrl: '', thumbnailUrl: '', tags: ['premium', 'special'], allergens: ['dairy', 'eggs'], dietaryTags: ['gluten-free'], calories: 980, costPerServing: 18.00, recipe: [], modifiers: [], sortOrder: 18, salesCount: 32, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
];

export const SEED_TABLES: Table[] = [
  { id: 'tbl-1', number: 1, name: 'Table 1',      capacity: 2,  status: 'available', shape: 'square', zone: 'Dining Room', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-2', number: 2, name: 'Table 2',      capacity: 4,  status: 'available', shape: 'square', zone: 'Dining Room', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-3', number: 3, name: 'Table 3',      capacity: 4,  status: 'available', shape: 'round',  zone: 'Dining Room', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-4', number: 4, name: 'Table 4',      capacity: 6,  status: 'available', shape: 'round',  zone: 'Dining Room', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-5', number: 5, name: 'Table 5',      capacity: 2,  status: 'available', shape: 'square', zone: 'Dining Room', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-6', number: 6, name: 'Bar Seats',    capacity: 4,  status: 'available', shape: 'bar',    zone: 'Bar',         createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-7', number: 7, name: 'Terrace 1',    capacity: 4,  status: 'available', shape: 'square', zone: 'Terrace',     createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-8', number: 8, name: 'Terrace 2',    capacity: 4,  status: 'available', shape: 'square', zone: 'Terrace',     createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-9', number: 9, name: 'Private Room', capacity: 10, status: 'available', shape: 'round',  zone: 'Private',     createdAt: new Date('2024-01-01').toISOString() },
];

export const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: 'The Urban Kitchen',
  businessType: 'Restaurant',
  currency: 'EUR',
  currencySymbol: '€',
  taxRate: 10,
  taxDisplay: 'inclusive',
  language: 'English',
  timezone: 'Europe/Paris',
  openingHours: '08:00 - 23:00',
  serviceMode: 'dine-in',
  lowStockThreshold: 5,
  zeroStockBehavior: 'disable',
  appUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080',
  logoUrl: '',
  restaurantToken: 'demo',
};

export const DEMO_USER: User = {
  id: 'user-demo',
  email: 'demo@smartline.io',
  name: 'Jordan Davis',
  businessName: 'The Urban Kitchen',
  role: 'admin',
  createdAt: new Date('2024-01-01').toISOString(),
};

export const SEED_INGREDIENTS: Ingredient[] = [
  { id: 'ing-1', name: 'Bread Flour', unit: 'kg', costPerUnit: 1.20, stock: 25, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-2', name: 'Mozzarella', unit: 'kg', costPerUnit: 8.50, stock: 10, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-3', name: 'San Marzano Tomato', unit: 'kg', costPerUnit: 3.20, stock: 15, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-4', name: 'Angus Beef Patty', unit: 'pcs', costPerUnit: 3.50, stock: 40, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-5', name: 'Atlantic Salmon', unit: 'kg', costPerUnit: 18.00, stock: 8, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-6', name: 'Espresso Coffee', unit: 'g', costPerUnit: 0.04, stock: 2000, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-7', name: 'Whole Milk', unit: 'l', costPerUnit: 1.10, stock: 30, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-8', name: 'Butter', unit: 'kg', costPerUnit: 7.20, stock: 5, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-9', name: 'Eggs', unit: 'pcs', costPerUnit: 0.28, stock: 120, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'ing-10', name: 'Arborio Rice', unit: 'kg', costPerUnit: 3.50, stock: 12, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
];

/**
 * Starter menu for newly-created accounts.
 * Items use null stock (unlimited) so a new owner can start taking orders
 * immediately without configuring inventory first.
 */
export const FRESH_MENU_ITEMS: MenuItem[] = [
  { id: 'starter-1', name: 'Grilled Chicken', description: 'Herb-marinated chicken breast, seasonal vegetables', price: 14.00, category: 'Food', prepTime: 15, stock: null, maxStock: null, status: 'active', icon: '🍗', imageUrl: '', thumbnailUrl: '', tags: ['popular'], allergens: [], dietaryTags: ['gluten-free', 'dairy-free'], recipe: [], modifiers: [], sortOrder: 1, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'starter-2', name: 'Garden Salad', description: 'Fresh mixed greens, cherry tomatoes, cucumber, house dressing', price: 9.50, category: 'Food', prepTime: 8, stock: null, maxStock: null, status: 'active', icon: '🥗', imageUrl: '', thumbnailUrl: '', tags: ['vegetarian', 'healthy'], allergens: [], dietaryTags: ['vegetarian', 'vegan', 'gluten-free', 'dairy-free'], recipe: [], modifiers: [], sortOrder: 2, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'starter-3', name: 'Margherita Pizza', description: 'Tomato sauce, fresh mozzarella, basil', price: 13.00, category: 'Food', prepTime: 12, stock: null, maxStock: null, status: 'active', icon: '🍕', imageUrl: '', thumbnailUrl: '', tags: ['vegetarian'], allergens: ['gluten', 'dairy'], dietaryTags: ['vegetarian'], recipe: [], modifiers: [], sortOrder: 3, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'starter-4', name: 'Sparkling Water', description: '500ml chilled sparkling water', price: 3.00, category: 'Drinks', prepTime: 1, stock: null, maxStock: null, status: 'active', icon: '💧', imageUrl: '', thumbnailUrl: '', tags: [], allergens: [], dietaryTags: ['vegan', 'gluten-free', 'dairy-free'], recipe: [], modifiers: [], sortOrder: 4, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'starter-5', name: 'Soft Drink', description: 'Cola, lemonade or orange juice — ask your server', price: 3.50, category: 'Drinks', prepTime: 1, stock: null, maxStock: null, status: 'active', icon: '🥤', imageUrl: '', thumbnailUrl: '', tags: [], allergens: [], dietaryTags: [], recipe: [], modifiers: [], sortOrder: 5, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
  { id: 'starter-6', name: 'Chocolate Brownie', description: 'Warm chocolate brownie, vanilla ice cream', price: 6.50, category: 'Desserts', prepTime: 3, stock: null, maxStock: null, status: 'active', icon: '🍫', imageUrl: '', thumbnailUrl: '', tags: [], allergens: ['gluten', 'dairy', 'eggs'], dietaryTags: ['vegetarian'], recipe: [], modifiers: [], sortOrder: 6, salesCount: 0, createdAt: new Date('2024-01-01').toISOString(), updatedAt: new Date('2024-01-01').toISOString() },
];

/** Starter tables for newly-created accounts. */
export const FRESH_TABLES: Table[] = [
  { id: 'tbl-s1', number: 1, name: 'Table 1', capacity: 2, status: 'available', shape: 'square', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-s2', number: 2, name: 'Table 2', capacity: 4, status: 'available', shape: 'square', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-s3', number: 3, name: 'Table 3', capacity: 4, status: 'available', shape: 'square', createdAt: new Date('2024-01-01').toISOString() },
  { id: 'tbl-s4', number: 4, name: 'Table 4', capacity: 6, status: 'available', shape: 'square', createdAt: new Date('2024-01-01').toISOString() },
];
