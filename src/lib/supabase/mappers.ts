/**
 * Bidirectional mappers between Supabase DB rows and domain types.
 *
 * DB uses snake_case + uuid PKs.
 * Domain uses camelCase + string IDs (UUIDs passed through as strings).
 */

import type {
  MenuItem, Table, Order, Receipt, BusinessSettings, StockReservation,
  Ingredient, KitchenEvent, Station,
  CalendarEvent, EventPackage, Employee, Shift,
} from '@/domain/types';

// ─── Business Settings ────────────────────────────────────────────────────────

export function mapSettingsRow(row: Record<string, unknown>): BusinessSettings {
  return {
    businessName:       row.business_name as string,
    businessType:       (row.business_type as string) ?? 'Restaurant',
    currency:           (row.currency as string) ?? 'EUR',
    currencySymbol:     (row.currency_symbol as string) ?? '€',
    taxRate:            Number(row.tax_rate ?? 10),
    taxDisplay:         (row.tax_display as BusinessSettings['taxDisplay']) ?? 'inclusive',
    language:           (row.language as string) ?? 'English',
    timezone:           (row.timezone as string) ?? 'UTC',
    openingHours:       (row.opening_hours as string) ?? '',
    serviceMode:        (row.service_mode as string) ?? 'dine-in',
    lowStockThreshold:  Number(row.low_stock_threshold ?? 5),
    zeroStockBehavior:  (row.zero_stock_behavior as BusinessSettings['zeroStockBehavior']) ?? 'disable',
    appUrl:             (row.app_url as string) ?? '',
    logoUrl:            (row.logo_url as string) ?? '',
    restaurantToken:        row.restaurant_token as string,
    orderingPaused:         Boolean(row.ordering_paused ?? false),
    orderingPausedMessage:  (row.ordering_paused_message as string) ?? '',
    takeawayEnabled:        Boolean(row.takeaway_enabled ?? true),
    deliveryEnabled:        Boolean(row.delivery_enabled ?? false),
    businessHours:          (row.business_hours as BusinessSettings['businessHours']) ?? undefined,
    stations:               (row.stations as Station[] | undefined) ?? [],
  };
}

export function settingsToRow(s: BusinessSettings, userId: string): Record<string, unknown> {
  return {
    user_id:              userId,
    business_name:        s.businessName,
    business_type:        s.businessType,
    currency:             s.currency,
    currency_symbol:      s.currencySymbol,
    tax_rate:             s.taxRate,
    tax_display:          s.taxDisplay,
    language:             s.language,
    timezone:             s.timezone,
    opening_hours:        s.openingHours,
    service_mode:         s.serviceMode,
    low_stock_threshold:  s.lowStockThreshold,
    zero_stock_behavior:  s.zeroStockBehavior,
    app_url:              s.appUrl,
    logo_url:             s.logoUrl,
    restaurant_token:          s.restaurantToken,
    ordering_paused:           s.orderingPaused ?? false,
    ordering_paused_message:   s.orderingPausedMessage ?? '',
    takeaway_enabled:          s.takeawayEnabled ?? true,
    delivery_enabled:          s.deliveryEnabled ?? false,
    business_hours:            s.businessHours ?? null,
    stations:                  s.stations ?? [],
  };
}

// ─── Menu Items ───────────────────────────────────────────────────────────────

export function mapMenuItemRow(row: Record<string, unknown>): MenuItem {
  return {
    id:             row.id as string,
    name:           row.name as string,
    description:    (row.description as string) ?? '',
    category:       (row.category as string) ?? '',
    price:          Number(row.price),
    prepTime:       Number(row.prep_time ?? 10),
    stock:          row.stock != null ? Number(row.stock) : null,
    maxStock:       row.max_stock != null ? Number(row.max_stock) : null,
    status:         (row.status as MenuItem['status']) ?? 'active',
    icon:           (row.icon as string) ?? '🍽️',
    imageUrl:       (row.image_url as string) ?? '',
    thumbnailUrl:   (row.thumbnail_url as string) ?? '',
    tags:           (row.tags as string[]) ?? [],
    modifiers:      (row.modifiers as MenuItem['modifiers']) ?? [],
    sortOrder:      Number(row.sort_order ?? 0),
    salesCount:     Number(row.sales_count ?? 0),
    // Extended fields — require DB columns: allergens, dietary_tags, calories, cost_per_serving, recipe
    allergens:      (row.allergens as string[] | undefined) ?? undefined,
    dietaryTags:    (row.dietary_tags as string[] | undefined) ?? undefined,
    calories:       row.calories != null ? Number(row.calories) : undefined,
    costPerServing: row.cost_per_serving != null ? Number(row.cost_per_serving) : undefined,
    recipe:         (row.recipe as MenuItem['recipe'] | undefined) ?? undefined,
    createdAt:      row.created_at as string,
    updatedAt:      row.updated_at as string,
  };
}

export function menuItemToRow(
  item: Omit<MenuItem, 'createdAt' | 'updatedAt'>,
  userId: string,
): Record<string, unknown> {
  return {
    id:             item.id,
    user_id:        userId,
    name:           item.name,
    description:    item.description,
    category:       item.category,
    price:          item.price,
    prep_time:      item.prepTime,
    stock:          item.stock,
    max_stock:      item.maxStock,
    status:         item.status,
    icon:           item.icon,
    image_url:      item.imageUrl,
    thumbnail_url:  item.thumbnailUrl,
    tags:           item.tags,
    modifiers:      item.modifiers,
    sort_order:     item.sortOrder,
    sales_count:    item.salesCount,
    // Extended fields — nullable columns in DB
    allergens:      item.allergens      ?? null,
    dietary_tags:   item.dietaryTags    ?? null,
    calories:       item.calories       ?? null,
    cost_per_serving: item.costPerServing ?? null,
    recipe:         item.recipe         ?? null,
  };
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export function mapTableRow(row: Record<string, unknown>): Table {
  return {
    id:        row.id as string,
    number:    Number(row.number),
    name:      row.name as string,
    capacity:  Number(row.capacity ?? 4),
    status:    (row.status as Table['status']) ?? 'available',
    shape:     (row.shape as Table['shape']) ?? 'square',
    zone:      (row.zone     as string | undefined) ?? undefined,
    floor:     (row.floor    as string | undefined) ?? undefined,
    rotation:  row.rotation  != null ? Number(row.rotation) : 0,
    x:         row.x != null ? Number(row.x) : null,
    y:         row.y != null ? Number(row.y) : null,
    sizeScale: row.size_scale != null ? Number(row.size_scale) : 1,
    createdAt: row.created_at as string,
  };
}

export function tableToRow(table: Table, userId: string): Record<string, unknown> {
  return {
    id:        table.id,
    user_id:   userId,
    number:    table.number,
    name:      table.name,
    capacity:  table.capacity,
    status:    table.status,
    shape:     table.shape,
    zone:      table.zone     ?? null,
    floor:     table.floor    ?? null,
    rotation:   table.rotation  ?? 0,
    x:          table.x         ?? null,
    y:          table.y         ?? null,
    size_scale: table.sizeScale ?? 1,
  };
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export function mapOrderRow(row: Record<string, unknown>): Order {
  return {
    id:                   row.id as string,
    orderNumber:          Number(row.order_number),
    tableId:              (row.table_id as string) ?? '',
    tableName:            (row.table_name as string) ?? '',
    items:                (row.items as Order['items']) ?? [],
    status:               (row.status as Order['status']) ?? 'paid',
    subtotal:             Number(row.subtotal ?? 0),
    taxRate:              Number(row.tax_rate ?? 0),
    taxAmount:            Number(row.tax_amount ?? 0),
    total:                Number(row.total ?? 0),
    paymentMethod:        (row.payment_method as Order['paymentMethod']) ?? 'cash',
    notes:                (row.notes as string) ?? '',
    scheduledFor:         (row.scheduled_for as string | undefined) || undefined,
    estimatedPrepTime:    Number(row.estimated_prep_time ?? 15),
    prepTimeAdjustment:   Number(row.prep_time_adjustment ?? 0),
    createdAt:            row.created_at as string,
    paidAt:               (row.paid_at as string) ?? row.created_at as string,
    updatedAt:            row.updated_at as string,
  };
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

export function mapReceiptRow(row: Record<string, unknown>): Receipt {
  return {
    id:             row.id as string,
    orderId:        (row.order_id as string) ?? '',
    orderNumber:    Number(row.order_number),
    tableId:        (row.table_id as string) ?? '',
    tableName:      (row.table_name as string) ?? '',
    restaurantName: (row.restaurant_name as string) ?? '',
    items:          (row.items as Receipt['items']) ?? [],
    subtotal:       Number(row.subtotal ?? 0),
    taxRate:        Number(row.tax_rate ?? 0),
    taxAmount:      Number(row.tax_amount ?? 0),
    total:          Number(row.total ?? 0),
    paymentMethod:  (row.payment_method as Receipt['paymentMethod']) ?? 'cash',
    createdAt:      row.created_at as string,
  };
}

// ─── Ingredients ─────────────────────────────────────────────────────────────

export function mapIngredientRow(row: Record<string, unknown>): Ingredient {
  return {
    id:           row.id as string,
    name:         row.name as string,
    unit:         (row.unit as string) ?? 'g',
    costPerUnit:  Number(row.cost_per_unit ?? 0),
    stock:        row.stock != null ? Number(row.stock) : undefined,
    createdAt:    row.created_at as string,
    updatedAt:    row.updated_at as string,
  };
}

export function ingredientToRow(ing: Ingredient, userId: string): Record<string, unknown> {
  return {
    id:            ing.id,
    user_id:       userId,
    name:          ing.name,
    unit:          ing.unit,
    cost_per_unit: ing.costPerUnit,
    stock:         ing.stock ?? null,
  };
}

// ─── Kitchen Events ───────────────────────────────────────────────────────────

export function mapKitchenEventRow(row: Record<string, unknown>): KitchenEvent {
  return {
    id:             row.id as string,
    orderId:        row.order_id as string,
    orderNumber:    Number(row.order_number ?? 0),
    type:           row.type as KitchenEvent['type'],
    notes:          (row.notes as string) ?? '',
    menuItemId:     (row.menu_item_id as string | undefined) ?? undefined,
    menuItemName:   (row.menu_item_name as string | undefined) ?? undefined,
    quantity:       row.quantity != null ? Number(row.quantity) : undefined,
    estimatedCost:  row.estimated_cost != null ? Number(row.estimated_cost) : undefined,
    stationId:      (row.station_id as string | undefined) ?? undefined,
    createdAt:      row.created_at as string,
  };
}

export function kitchenEventToRow(event: KitchenEvent, userId: string): Record<string, unknown> {
  return {
    id:              event.id,
    user_id:         userId,
    order_id:        event.orderId,
    order_number:    event.orderNumber,
    type:            event.type,
    notes:           event.notes,
    menu_item_id:    event.menuItemId    ?? null,
    menu_item_name:  event.menuItemName  ?? null,
    quantity:        event.quantity      ?? null,
    estimated_cost:  event.estimatedCost ?? null,
    station_id:      event.stationId     ?? null,
  };
}

// ─── Stock Reservations ───────────────────────────────────────────────────────

export function mapReservationRow(row: Record<string, unknown>): StockReservation {
  return {
    id:        row.id as string,
    sessionId: row.session_id as string,
    items:     (row.items as StockReservation['items']) ?? [],
    expiresAt: new Date(row.expires_at as string).getTime(),
  };
}

// ─── Calendar Events ──────────────────────────────────────────────────────────

export function mapCalendarEventRow(row: Record<string, unknown>): CalendarEvent {
  return {
    id:              row.id as string,
    date:            row.date as string,
    timeSlot:        row.time_slot as string,
    endTime:         (row.end_time as string | undefined) ?? undefined,
    type:            row.type as CalendarEvent['type'],
    status:          row.status as CalendarEvent['status'],
    customerName:    (row.customer_name as string) ?? '',
    customerPhone:   (row.customer_phone as string) ?? '',
    customerEmail:   (row.customer_email as string) ?? '',
    guestCount:      Number(row.guest_count ?? 1),
    packageId:       (row.package_id as string | undefined) ?? undefined,
    packageName:     (row.package_name as string | undefined) ?? undefined,
    notes:           (row.notes as string) ?? '',
    closureReason:   (row.closure_reason as string | undefined) ?? undefined,
    createdBy:       (row.created_by as CalendarEvent['createdBy']) ?? 'manager',
    approvedBy:      (row.approved_by as string | undefined) ?? undefined,
    approvedAt:      (row.approved_at as string | undefined) ?? undefined,
    rejectionReason: (row.rejection_reason as string | undefined) ?? undefined,
    createdAt:       row.created_at as string,
    updatedAt:       row.updated_at as string,
  };
}

export function calendarEventToRow(event: CalendarEvent, userId: string): Record<string, unknown> {
  return {
    id:               event.id,
    user_id:          userId,
    date:             event.date,
    time_slot:        event.timeSlot,
    end_time:         event.endTime    ?? null,
    type:             event.type,
    status:           event.status,
    customer_name:    event.customerName,
    customer_phone:   event.customerPhone,
    customer_email:   event.customerEmail,
    guest_count:      event.guestCount,
    package_id:       event.packageId   ?? null,
    package_name:     event.packageName ?? null,
    notes:            event.notes,
    closure_reason:   event.closureReason  ?? null,
    created_by:       event.createdBy,
    approved_by:      event.approvedBy  ?? null,
    approved_at:      event.approvedAt  ?? null,
    rejection_reason: event.rejectionReason ?? null,
    created_at:       event.createdAt,
    updated_at:       event.updatedAt,
  };
}

// ─── Event Packages ───────────────────────────────────────────────────────────

export function mapEventPackageRow(row: Record<string, unknown>): EventPackage {
  return {
    id:             row.id as string,
    name:           row.name as string,
    emoji:          (row.emoji as string) ?? '🎉',
    description:    (row.description as string) ?? '',
    minGuests:      Number(row.min_guests ?? 1),
    maxGuests:      Number(row.max_guests ?? 100),
    fixedPrice:     row.fixed_price != null ? Number(row.fixed_price) : undefined,
    pricePerPerson: row.price_per_person != null ? Number(row.price_per_person) : undefined,
    duration:       Number(row.duration ?? 2),
    details:        (row.details as string) ?? '',
    active:         Boolean(row.active ?? true),
    createdAt:      row.created_at as string,
  };
}

export function eventPackageToRow(pkg: EventPackage, userId: string): Record<string, unknown> {
  return {
    id:               pkg.id,
    user_id:          userId,
    name:             pkg.name,
    emoji:            pkg.emoji,
    description:      pkg.description,
    min_guests:       pkg.minGuests,
    max_guests:       pkg.maxGuests,
    fixed_price:      pkg.fixedPrice     ?? null,
    price_per_person: pkg.pricePerPerson ?? null,
    duration:         pkg.duration,
    details:          pkg.details,
    active:           pkg.active,
    created_at:       pkg.createdAt,
  };
}

// ─── Employees ────────────────────────────────────────────────────────────────

export function mapEmployeeRow(row: Record<string, unknown>): Employee {
  return {
    id:        row.id as string,
    name:      row.name as string,
    role:      (row.role as string) ?? '',
    phone:     (row.phone as string | undefined) ?? undefined,
    email:     (row.email as string | undefined) ?? undefined,
    color:     (row.color as string) ?? '#6366f1',
    active:    Boolean(row.active ?? true),
    createdAt: row.created_at as string,
  };
}

export function employeeToRow(emp: Employee, userId: string): Record<string, unknown> {
  return {
    id:         emp.id,
    user_id:    userId,
    name:       emp.name,
    role:       emp.role,
    phone:      emp.phone ?? null,
    email:      emp.email ?? null,
    color:      emp.color,
    active:     emp.active,
    created_at: emp.createdAt,
  };
}

// ─── Shifts ───────────────────────────────────────────────────────────────────

export function mapShiftRow(row: Record<string, unknown>): Shift {
  // Try new assignments column first; fall back to legacy employee_ids + role
  const rawAssignments = row.assignments as Array<Record<string, unknown>> | null | undefined;
  let assignments: import('@/domain/types').ShiftAssignment[];

  if (rawAssignments && rawAssignments.length > 0) {
    assignments = rawAssignments.map(a => ({
      employeeId: (a.employeeId ?? a.employee_id ?? '') as string,
      role:       (a.role ?? 'Staff') as string,
      roleNote:   (a.roleNote ?? a.role_note) as string | undefined,
    }));
  } else {
    // Legacy: employee_ids array + single role label
    const empIds = (row.employee_ids as string[] | null) ?? [];
    const legacyRole = (row.role as string) ?? 'Staff';
    assignments = empIds.map(id => ({ employeeId: id, role: legacyRole }));
  }

  return {
    id:          row.id as string,
    date:        row.date as string,
    name:        ((row.name ?? row.role) as string) ?? 'Shift',
    startTime:   row.start_time as string,
    endTime:     row.end_time as string,
    color:       (row.color as string) ?? '#6366f1',
    stationId:   row.station_id as string | undefined,
    assignments,
    minStaff:    Number(row.min_staff ?? 1),
    notes:       (row.notes as string) ?? '',
    createdAt:   row.created_at as string,
  };
}

export function shiftToRow(shift: Shift, userId: string): Record<string, unknown> {
  return {
    id:           shift.id,
    user_id:      userId,
    date:         shift.date,
    name:         shift.name,
    role:         shift.name,        // keep role col in sync for legacy compat
    start_time:   shift.startTime,
    end_time:     shift.endTime,
    color:        shift.color,
    station_id:   shift.stationId ?? null,
    assignments:  shift.assignments,
    employee_ids: shift.assignments.map(a => a.employeeId),  // keep legacy col
    min_staff:    shift.minStaff,
    notes:        shift.notes,
    created_at:   shift.createdAt,
  };
}
