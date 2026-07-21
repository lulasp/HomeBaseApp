import React, { useEffect, useState, useMemo, useCallback, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import {
  subscribeBills, addBill, updateBill, deleteBill,
  subscribeExpenses, addExpense, updateExpense, deleteExpense,
  getHousehold,
} from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import DatePickerInput from '../../components/DatePickerInput';
import { BILL_CATS, EXPENSE_CATS, withCustomCats } from '../../utils/financeCategories';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMonthKey() {
  return format(new Date(), 'yyyy-MM');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtCurrency(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Money spent by an expense — income rows (direction 'in') don't count toward spend totals.
function spentAmount(e) {
  return e.direction === 'in' ? 0 : Number(e.amount || 0);
}

function fmtMonthGroup(key) {
  const [yr, mo] = key.split('-');
  return format(new Date(Number(yr), Number(mo) - 1, 1), 'MMMM yyyy');
}

const BLANK_BILL    = { name: '', category: 'other', amount: '', dueDayOfMonth: '', notes: '' };
const blankExpense  = () => ({
  title: '', category: 'other', amount: '',
  date: format(new Date(), 'yyyy-MM-dd'), paidBy: '', notes: '',
});

// ── Category chip ──────────────────────────────────────────────────────────────

const CatChip = memo(function CatChip({ cat, selected, onSelect, colors }) {
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  return (
    <TouchableOpacity
      style={[
        chipSt.chip,
        {
          borderColor: selected ? iconColor : colors.border,
          backgroundColor: selected ? iconColor + '22' : colors.surfaceElevated,
        },
      ]}
      onPress={() => onSelect(cat.key)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {cat.isCustom
        ? <Text style={chipSt.emoji}>{cat.icon}</Text>
        : <Ionicons name={cat.icon} size={13} color={iconColor} />
      }
      <Text style={[chipSt.label, { color: selected ? iconColor : colors.textSecondary }]}>
        {cat.label}
      </Text>
    </TouchableOpacity>
  );
});

const chipSt = StyleSheet.create({
  chip:  {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1,
  },
  label: { ...type.caption, fontWeight: '600' },
  emoji: { fontSize: 12, lineHeight: 16 },
});

// ── Bill card ──────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const BillCard = memo(function BillCard({ bill, cats, monthKey, onEdit, onDelete, onTogglePaid, colors, styles }) {
  const cat       = cats.find(c => c.key === bill.category) || cats[cats.length - 1];
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  const today     = new Date();
  const todayDay  = today.getDate();
  const isPaid    = bill.paidMonths?.includes(monthKey);
  const isOverdue = !isPaid && bill.dueDayOfMonth < todayDay;
  const isDueSoon = !isPaid && !isOverdue && bill.dueDayOfMonth <= todayDay + 5;

  const statusColor = isPaid ? colors.sage : isOverdue ? colors.danger : isDueSoon ? colors.amber : colors.textTertiary;
  const statusBg    = isPaid ? colors.sageSoft : isOverdue ? colors.dangerSoft : isDueSoon ? colors.amberSoft : colors.muted;
  const statusIcon  = isPaid ? 'checkmark-circle' : isOverdue ? 'alert-circle' : isDueSoon ? 'time' : 'calendar-outline';
  const statusLabel = isPaid ? 'Paid' : isOverdue ? 'Overdue' : isDueSoon ? 'Due soon' : `Due ${ordinal(bill.dueDayOfMonth)}`;

  const daysUntil = bill.dueDayOfMonth - todayDay;
  const daysText  = isPaid ? `Due ${ordinal(bill.dueDayOfMonth)} each month`
    : daysUntil === 0 ? 'Due today'
    : daysUntil < 0   ? `${Math.abs(daysUntil)}d overdue`
    : `in ${daysUntil}d`;
  const daysColor = isPaid ? colors.textTertiary : isOverdue ? colors.danger : isDueSoon ? colors.amber : colors.textTertiary;

  const year = today.getFullYear();

  return (
    <View style={styles.billCard}>
      <View style={[styles.billAccent, { backgroundColor: statusColor }]} />
      <View style={styles.billCardInner}>

        {/* Header: icon + name + amount */}
        <View style={styles.billCardHeader}>
          <View style={[styles.billCatIcon, { backgroundColor: iconColor + '22' }]}>
            {cat.isCustom
              ? <Text style={styles.catEmoji}>{cat.icon}</Text>
              : <Ionicons name={cat.icon} size={20} color={iconColor} />
            }
          </View>
          <View style={styles.billCardTitleCol}>
            <Text style={styles.billCardName} numberOfLines={1}>{bill.name}</Text>
            <View style={[styles.catPill, { backgroundColor: iconColor + '18' }]}>
              <Text style={[styles.catPillLabel, { color: iconColor }]}>{cat.label}</Text>
            </View>
          </View>
          <View style={styles.billCardAmountCol}>
            <Text style={[styles.billCardAmount, isPaid && { color: colors.textTertiary }]}>
              {fmtCurrency(bill.amount)}
            </Text>
            <Text style={styles.billCardAmountSub}>/ month</Text>
          </View>
        </View>

        {/* Status + days text */}
        <View style={styles.billStatusRow}>
          <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={11} color={statusColor} />
            <Text style={[styles.statusPillLabel, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Text style={[styles.daysText, { color: daysColor }]}>{daysText}</Text>
        </View>

        {/* Notes */}
        {!!bill.notes && (
          <View style={styles.notesRow}>
            <Ionicons name="document-text-outline" size={12} color={colors.textTertiary} />
            <Text style={styles.notesText} numberOfLines={2}>{bill.notes}</Text>
          </View>
        )}

        {/* 12-month payment history */}
        <View style={styles.historyRow}>
          {MONTHS_SHORT.map((m, i) => {
            const mk    = `${year}-${String(i + 1).padStart(2, '0')}`;
            const paid  = bill.paidMonths?.includes(mk);
            const isCur = mk === monthKey;
            const fut   = mk > monthKey;
            return (
              <View key={m} style={styles.historyItem}>
                <View style={[
                  styles.historyDot,
                  { borderColor: isCur ? statusColor : colors.border },
                  paid  && { backgroundColor: colors.sage, borderColor: colors.sage },
                  fut   && { opacity: 0.3 },
                ]}>
                  {paid && <Ionicons name="checkmark" size={7} color="#fff" />}
                </View>
                <Text style={[styles.historyMonth, isCur && { color: colors.textPrimary, fontWeight: '700' }]}>
                  {m[0]}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Actions */}
        <View style={styles.billCardActions}>
          <TouchableOpacity
            style={[styles.togglePaidBtn, {
              borderColor: isPaid ? colors.sage : colors.border,
              backgroundColor: isPaid ? colors.sageSoft : 'transparent',
            }]}
            onPress={() => onTogglePaid(bill, monthKey, isPaid)}
            accessibilityRole="button"
            accessibilityLabel={isPaid ? 'Mark unpaid' : 'Mark paid'}
          >
            <Ionicons name={isPaid ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={isPaid ? colors.sage : colors.textTertiary} />
            <Text style={[styles.togglePaidLabel, { color: isPaid ? colors.sage : colors.textSecondary }]}>
              {isPaid ? 'Paid this month' : 'Mark as paid'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onEdit(bill)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDelete(bill)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// ── Expense card ───────────────────────────────────────────────────────────────

const ExpenseCard = memo(function ExpenseCard({ expense, cats, onEdit, onDelete, colors, styles }) {
  const cat       = cats.find(c => c.key === expense.category) || cats[cats.length - 1];
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  const dateLabel = expense.date ? format(new Date(expense.date + 'T00:00:00'), 'MMM d, yyyy') : '';
  const isIncome  = expense.direction === 'in';

  return (
    <View style={styles.expenseCard}>
      {/* Header: icon + info + amount */}
      <View style={styles.expCardHeader}>
        <View style={[styles.expCatIcon, { backgroundColor: iconColor + '22' }]}>
          {cat.isCustom
            ? <Text style={styles.catEmoji}>{cat.icon}</Text>
            : <Ionicons name={cat.icon} size={20} color={iconColor} />
          }
        </View>
        <View style={styles.expCardInfo}>
          <Text style={styles.expCardTitle} numberOfLines={1}>{expense.title}</Text>
          <View style={styles.expCardMeta}>
            <Ionicons name="calendar-outline" size={11} color={colors.textTertiary} />
            <Text style={styles.expCardDate}>{dateLabel}</Text>
            {!!expense.paidBy && (
              <>
                <Text style={styles.expCardSep}>·</Text>
                <Ionicons name="person-outline" size={11} color={colors.textTertiary} />
                <Text style={styles.expCardPaidBy}>{expense.paidBy}</Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.expCardRight}>
          <Text style={[styles.expCardAmount, isIncome && { color: colors.sage }]}>
            {isIncome ? '+' : ''}{fmtCurrency(expense.amount)}
          </Text>
          <View style={[styles.catPill, { backgroundColor: iconColor + '18', alignSelf: 'flex-end' }]}>
            <Text style={[styles.catPillLabel, { color: iconColor }]}>{cat.label}</Text>
          </View>
        </View>
      </View>

      {/* Notes */}
      {!!expense.notes && (
        <View style={styles.notesRow}>
          <Ionicons name="document-text-outline" size={12} color={colors.textTertiary} />
          <Text style={styles.notesText} numberOfLines={2}>{expense.notes}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.expCardActions}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => onEdit(expense)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(expense)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function BillsExpensesScreen({ navigation }) {
  const { householdId, displayName } = useAuth();
  const { colors }    = useTheme();
  const { showConfirm } = useAlert();
  const isDesktop     = useIsDesktop();
  const styles        = useMemo(() => makeStyles(colors), [colors]);

  const [activeTab,       setActiveTab]       = useState('bills');
  const [bills,           setBills]           = useState([]);
  const [expenses,        setExpenses]        = useState([]);
  const [customBillCats,  setCustomBillCats]  = useState([]);
  const [customExpCats,   setCustomExpCats]   = useState([]);
  const [modalVisible,  setModalVisible]  = useState(false);
  const [modalType,     setModalType]     = useState('bill');
  const [editingId,     setEditingId]     = useState(null);
  const [billForm,      setBillForm]      = useState(BLANK_BILL);
  const [expenseForm,   setExpenseForm]   = useState(blankExpense());
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);

  const monthKey = useMemo(() => getMonthKey(), []);

  useEffect(() => {
    if (!householdId) return;
    getHousehold(householdId).then(hh => {
      setCustomBillCats(hh?.billCustomCategories ?? []);
      setCustomExpCats(hh?.expenseCustomCategories ?? []);
    });
  }, [householdId]);

  const allBillCats    = useMemo(() => withCustomCats(BILL_CATS, customBillCats), [customBillCats]);
  const allExpenseCats = useMemo(() => withCustomCats(EXPENSE_CATS, customExpCats), [customExpCats]);

  useEffect(() => {
    if (!householdId) return;
    return subscribeBills(householdId, (data) =>
      setBills(data.sort((a, b) => (a.dueDayOfMonth || 0) - (b.dueDayOfMonth || 0)))
    );
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    return subscribeExpenses(householdId, (data) =>
      setExpenses(data.sort((a, b) => (b.date || '').localeCompare(a.date || '')))
    );
  }, [householdId]);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const monthlyTotal   = useMemo(() => bills.reduce((s, b) => s + Number(b.amount || 0), 0), [bills]);
  const paidAmount     = useMemo(() => bills.filter(b => b.paidMonths?.includes(monthKey)).reduce((s, b) => s + Number(b.amount || 0), 0), [bills, monthKey]);
  const paidCount      = useMemo(() => bills.filter(b => b.paidMonths?.includes(monthKey)).length, [bills, monthKey]);
  const outstanding    = useMemo(() => monthlyTotal - paidAmount, [monthlyTotal, paidAmount]);

  const yearPrefix     = useMemo(() => format(new Date(), 'yyyy'), []);
  const thisMonthTotal = useMemo(() => expenses.filter(e => e.date?.startsWith(monthKey)).reduce((s, e) => s + spentAmount(e), 0), [expenses, monthKey]);
  const thisYearTotal  = useMemo(() => expenses.filter(e => e.date?.startsWith(yearPrefix)).reduce((s, e) => s + spentAmount(e), 0), [expenses, yearPrefix]);

  const groupedExpenses = useMemo(() => {
    const groups = {};
    expenses.forEach(e => {
      const key = e.date?.substring(0, 7) || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [expenses]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openNew = useCallback(() => {
    const t = activeTab === 'bills' ? 'bill' : 'expense';
    setModalType(t);
    setEditingId(null);
    setBillForm(BLANK_BILL);
    setExpenseForm(blankExpense());
    setErrors({});
    setModalVisible(true);
  }, [activeTab]);

  const openEditBill = useCallback((bill) => {
    setModalType('bill');
    setEditingId(bill.id);
    setBillForm({
      name:          bill.name          || '',
      category:      bill.category      || 'other',
      amount:        String(bill.amount || ''),
      dueDayOfMonth: String(bill.dueDayOfMonth || ''),
      notes:         bill.notes         || '',
    });
    setErrors({});
    setModalVisible(true);
  }, []);

  const openEditExpense = useCallback((expense) => {
    setModalType('expense');
    setEditingId(expense.id);
    setExpenseForm({
      title:    expense.title    || '',
      category: expense.category || 'other',
      amount:   String(expense.amount || ''),
      date:     expense.date     || format(new Date(), 'yyyy-MM-dd'),
      paidBy:   expense.paidBy   || '',
      notes:    expense.notes    || '',
    });
    setErrors({});
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingId(null);
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSaveBill = useCallback(async () => {
    const errs = {};
    if (!billForm.name.trim()) errs.name = true;
    if (!billForm.amount || isNaN(Number(billForm.amount))) errs.amount = true;
    const day = Number(billForm.dueDayOfMonth);
    if (!day || day < 1 || day > 31) errs.dueDayOfMonth = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const data = {
        name: billForm.name.trim(),
        category: billForm.category,
        amount: Number(billForm.amount),
        dueDayOfMonth: day,
        notes: billForm.notes.trim(),
      };
      if (editingId) await updateBill(householdId, editingId, data);
      else           await addBill(householdId, data);
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [billForm, editingId, householdId, closeModal]);

  const handleSaveExpense = useCallback(async () => {
    const errs = {};
    if (!expenseForm.title.trim()) errs.title = true;
    if (!expenseForm.amount || isNaN(Number(expenseForm.amount))) errs.amount = true;
    if (!expenseForm.date) errs.date = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const data = {
        title:    expenseForm.title.trim(),
        category: expenseForm.category,
        amount:   Number(expenseForm.amount),
        date:     expenseForm.date,
        paidBy:   expenseForm.paidBy.trim(),
        notes:    expenseForm.notes.trim(),
      };
      if (editingId) await updateExpense(householdId, editingId, data);
      else           await addExpense(householdId, data);
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [expenseForm, editingId, householdId, closeModal]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDeleteBill = useCallback(async (bill) => {
    const ok = await showConfirm({
      title: 'Delete bill',
      message: `Remove "${bill.name}"? This can't be undone.`,
      confirmLabel: 'Delete',
      type: 'danger',
    });
    if (ok) deleteBill(householdId, bill.id);
  }, [householdId, showConfirm]);

  const handleDeleteExpense = useCallback(async (expense) => {
    const ok = await showConfirm({
      title: 'Delete expense',
      message: `Remove "${expense.title}"? This can't be undone.`,
      confirmLabel: 'Delete',
      type: 'danger',
    });
    if (ok) deleteExpense(householdId, expense.id);
  }, [householdId, showConfirm]);

  const handleTogglePaid = useCallback((bill, key, isPaid) => {
    const next = isPaid
      ? (bill.paidMonths || []).filter(m => m !== key)
      : [...(bill.paidMonths || []), key];
    updateBill(householdId, bill.id, { paidMonths: next });
  }, [householdId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.root, Platform.OS === 'android' && { paddingTop: 24 }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.container,
          isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Finances</Text>
            <Text style={styles.subtitle}>Bills & expenses</Text>
          </View>
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => navigation.navigate('StatementImport')}
            accessibilityRole="button"
            accessibilityLabel="Import bank statement"
          >
            <Ionicons name="document-attach-outline" size={16} color={colors.accent} />
            <Text style={styles.importBtnText}>Import</Text>
          </TouchableOpacity>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          {[['bills', 'Recurring Bills'], ['expenses', 'Expenses']].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.tabBtn, activeTab === key && styles.tabBtnActive]}
              onPress={() => setActiveTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === key }}
            >
              <Text style={[styles.tabBtnLabel, activeTab === key && styles.tabBtnLabelActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Bills tab ─────────────────────────────────────────────────── */}
        {activeTab === 'bills' && (
          <>
            {bills.length > 0 && (
              <View style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryValue}>{fmtCurrency(monthlyTotal)}</Text>
                  <Text style={styles.summaryLabel}>Monthly</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={[styles.summaryValue, { color: colors.sage }]}>{fmtCurrency(paidAmount)}</Text>
                  <Text style={styles.summaryLabel}>Paid {paidCount}/{bills.length}</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={[styles.summaryValue, { color: outstanding > 0 ? colors.danger : colors.sage }]}>
                    {fmtCurrency(outstanding)}
                  </Text>
                  <Text style={styles.summaryLabel}>Outstanding</Text>
                </View>
              </View>
            )}

            {bills.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>No bills yet</Text>
                <Text style={styles.emptySub}>Add your first recurring bill — rent, electricity, internet…</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {bills.map(bill => (
                  <BillCard
                    key={bill.id}
                    bill={bill}
                    cats={allBillCats}
                    monthKey={monthKey}
                    onEdit={openEditBill}
                    onDelete={handleDeleteBill}
                    onTogglePaid={handleTogglePaid}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </View>
            )}
          </>
        )}

        {/* ── Expenses tab ──────────────────────────────────────────────── */}
        {activeTab === 'expenses' && (
          <>
            {expenses.length > 0 && (
              <View style={[styles.summaryRow, { gap: spacing.md }]}>
                <View style={[styles.summaryCard, { flex: 1 }]}>
                  <Text style={[styles.summaryValue, { color: colors.amber }]}>{fmtCurrency(thisMonthTotal)}</Text>
                  <Text style={styles.summaryLabel}>This month</Text>
                </View>
                <View style={[styles.summaryCard, { flex: 1 }]}>
                  <Text style={styles.summaryValue}>{fmtCurrency(thisYearTotal)}</Text>
                  <Text style={styles.summaryLabel}>This year</Text>
                </View>
              </View>
            )}

            {groupedExpenses.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="cash-outline" size={48} color={colors.textTertiary} />
                <Text style={styles.emptyTitle}>No expenses yet</Text>
                <Text style={styles.emptySub}>Track household spending — repairs, cleaning, appliances…</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {groupedExpenses.map(([key, items]) => (
                  <View key={key} style={styles.monthGroup}>
                    <View style={styles.monthGroupHeader}>
                      <Text style={styles.monthGroupLabel}>{fmtMonthGroup(key)}</Text>
                      <Text style={styles.monthGroupTotal}>
                        {fmtCurrency(items.reduce((s, e) => s + spentAmount(e), 0))}
                      </Text>
                    </View>
                    {items.map(expense => (
                      <ExpenseCard
                        key={expense.id}
                        expense={expense}
                        cats={allExpenseCats}
                        onEdit={openEditExpense}
                        onDelete={handleDeleteExpense}
                        colors={colors}
                        styles={styles}
                      />
                    ))}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 180 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.accent }]}
        onPress={openNew}
        accessibilityRole="button"
        accessibilityLabel={`Add ${activeTab === 'bills' ? 'bill' : 'expense'}`}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add / Edit modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={closeModal} activeOpacity={1} />

          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            {/* Drag handle */}
            <View style={styles.handleRow}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>

            {/* Sheet title */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {modalType === 'bill'
                  ? (editingId ? 'Edit Bill' : 'Add Bill')
                  : (editingId ? 'Edit Expense' : 'Add Expense')}
              </Text>
              <TouchableOpacity onPress={closeModal} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {modalType === 'bill' ? (
                <>
                  <Text style={styles.fieldLabel}>Bill name *</Text>
                  <TextInput
                    style={[styles.input, errors.name && styles.inputError]}
                    placeholder="e.g. Electricity"
                    placeholderTextColor={colors.textTertiary}
                    value={billForm.name}
                    onChangeText={v => { setBillForm(f => ({ ...f, name: v })); setErrors(e => ({ ...e, name: false })); }}
                  />

                  <Text style={styles.fieldLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsWrapContent}>
                    {allBillCats.map(cat => (
                      <CatChip
                        key={cat.key}
                        cat={cat}
                        selected={billForm.category === cat.key}
                        onSelect={v => setBillForm(f => ({ ...f, category: v }))}
                        colors={colors}
                      />
                    ))}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>Monthly amount *</Text>
                  <View style={[styles.inputPrefix, errors.amount && styles.inputError]}>
                    <Text style={styles.prefixText}>$</Text>
                    <TextInput
                      style={styles.inputInner}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      value={billForm.amount}
                      onChangeText={v => { setBillForm(f => ({ ...f, amount: v })); setErrors(e => ({ ...e, amount: false })); }}
                      keyboardType="decimal-pad"
                    />
                  </View>

                  <Text style={styles.fieldLabel}>Due day of month * (1–31)</Text>
                  <TextInput
                    style={[styles.input, errors.dueDayOfMonth && styles.inputError]}
                    placeholder="e.g. 15"
                    placeholderTextColor={colors.textTertiary}
                    value={billForm.dueDayOfMonth}
                    onChangeText={v => { setBillForm(f => ({ ...f, dueDayOfMonth: v })); setErrors(e => ({ ...e, dueDayOfMonth: false })); }}
                    keyboardType="number-pad"
                    maxLength={2}
                  />

                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    placeholder="Optional"
                    placeholderTextColor={colors.textTertiary}
                    value={billForm.notes}
                    onChangeText={v => setBillForm(f => ({ ...f, notes: v }))}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Title *</Text>
                  <TextInput
                    style={[styles.input, errors.title && styles.inputError]}
                    placeholder="e.g. Plumber repair"
                    placeholderTextColor={colors.textTertiary}
                    value={expenseForm.title}
                    onChangeText={v => { setExpenseForm(f => ({ ...f, title: v })); setErrors(e => ({ ...e, title: false })); }}
                  />

                  <Text style={styles.fieldLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsWrapContent}>
                    {allExpenseCats.map(cat => (
                      <CatChip
                        key={cat.key}
                        cat={cat}
                        selected={expenseForm.category === cat.key}
                        onSelect={v => setExpenseForm(f => ({ ...f, category: v }))}
                        colors={colors}
                      />
                    ))}
                  </ScrollView>

                  <Text style={styles.fieldLabel}>Amount *</Text>
                  <View style={[styles.inputPrefix, errors.amount && styles.inputError]}>
                    <Text style={styles.prefixText}>$</Text>
                    <TextInput
                      style={styles.inputInner}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      value={expenseForm.amount}
                      onChangeText={v => { setExpenseForm(f => ({ ...f, amount: v })); setErrors(e => ({ ...e, amount: false })); }}
                      keyboardType="decimal-pad"
                    />
                  </View>

                  <Text style={styles.fieldLabel}>Date *</Text>
                  <DatePickerInput
                    value={expenseForm.date}
                    onChange={v => { setExpenseForm(f => ({ ...f, date: v })); setErrors(e => ({ ...e, date: false })); }}
                    hasError={!!errors.date}
                  />

                  <Text style={styles.fieldLabel}>Paid by</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={displayName || 'Name'}
                    placeholderTextColor={colors.textTertiary}
                    value={expenseForm.paidBy}
                    onChangeText={v => setExpenseForm(f => ({ ...f, paidBy: v }))}
                  />

                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    placeholder="Optional"
                    placeholderTextColor={colors.textTertiary}
                    value={expenseForm.notes}
                    onChangeText={v => setExpenseForm(f => ({ ...f, notes: v }))}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.accent }, saving && { opacity: 0.6 }]}
                onPress={modalType === 'bill' ? handleSaveBill : handleSaveExpense}
                disabled={saving}
                accessibilityRole="button"
              >
                <Text style={styles.saveBtnLabel}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (colors) => StyleSheet.create({
  root:      { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },

  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: spacing.xxl,
  },
  title:    { ...type.h2, color: colors.textPrimary, marginBottom: 4 },
  subtitle: { ...type.body, color: colors.textTertiary },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.accent,
  },
  headerBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.accent,
  },
  importBtnText: { ...type.caption, color: colors.accent, fontWeight: '700' },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    padding: 3,
    marginBottom: spacing.xxl,
  },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.md },
  tabBtnActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  tabBtnLabel:       { ...type.bodyMed, color: colors.textTertiary, fontSize: 14 },
  tabBtnLabelActive: { color: colors.textPrimary },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xxl },
  summaryCard: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', gap: 2,
  },
  summaryValue: { ...type.h4, color: colors.textPrimary },
  summaryLabel: { ...type.caption, color: colors.textTertiary, textAlign: 'center' },

  emptyState: { alignItems: 'center', gap: spacing.md, marginTop: 60 },
  emptyTitle: { ...type.h4, color: colors.textSecondary },
  emptySub:   { ...type.body, color: colors.textTertiary, textAlign: 'center', maxWidth: 280 },

  list:            { gap: spacing.sm },
  monthGroup:       { gap: spacing.sm },
  monthGroupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  monthGroupLabel: { ...type.label, color: colors.textTertiary },
  monthGroupTotal: { ...type.label, color: colors.textSecondary, fontWeight: '700' },

  catEmoji: { fontSize: 20, lineHeight: 24 },

  // ── Shared category pill ──────────────────────────────────────────────────
  catPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: radius.full,
  },
  catPillLabel: { ...type.caption, fontWeight: '700', fontSize: 10 },

  // ── Shared notes row ──────────────────────────────────────────────────────
  notesRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 5,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  notesText: { ...type.caption, color: colors.textSecondary, flex: 1, lineHeight: 17 },

  // ── Bill card ─────────────────────────────────────────────────────────────
  billCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  billAccent:     { width: 4, flexShrink: 0 },
  billCardInner:  { flex: 1, padding: spacing.lg, gap: spacing.md },
  billCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  billCatIcon: {
    width: 44, height: 44, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  billCardTitleCol: { flex: 1, gap: 5, minWidth: 0 },
  billCardName:     { ...type.bodyMed, color: colors.textPrimary },
  billCardAmountCol: { alignItems: 'flex-end', gap: 2 },
  billCardAmount:    { ...type.h4, color: colors.textPrimary },
  billCardAmountSub: { ...type.caption, color: colors.textTertiary },

  billStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.full,
  },
  statusPillLabel: { ...type.caption, fontWeight: '700' },
  daysText: { ...type.caption, fontWeight: '600' },

  historyRow:  { flexDirection: 'row', justifyContent: 'space-between' },
  historyItem: { alignItems: 'center', gap: 3 },
  historyDot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  historyMonth: { ...type.caption, color: colors.textTertiary, fontSize: 9 },

  billCardActions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: 2,
  },
  togglePaidBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 34, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1,
  },
  togglePaidLabel: { ...type.bodySm, fontWeight: '600' },

  // ── Expense card ──────────────────────────────────────────────────────────
  expenseCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.sm,
  },
  expCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  expCatIcon: {
    width: 44, height: 44, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  expCardInfo:   { flex: 1, gap: 5, minWidth: 0 },
  expCardTitle:  { ...type.bodyMed, color: colors.textPrimary },
  expCardMeta:   { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  expCardDate:   { ...type.caption, color: colors.textTertiary },
  expCardSep:    { ...type.caption, color: colors.textTertiary },
  expCardPaidBy: { ...type.caption, color: colors.textTertiary },
  expCardRight:  { alignItems: 'flex-end', gap: 5 },
  expCardAmount: { ...type.h4, color: colors.textPrimary },
  expCardActions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },

  fab: {
    position: 'absolute', right: spacing.xl, bottom: 160,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },

  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  handleRow:   { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  handle:      { width: 36, height: 4, borderRadius: 2 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetTitle: { ...type.h4, color: colors.textPrimary },
  sheetBody:  {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },

  fieldLabel: { ...type.label, color: colors.textSecondary, marginTop: spacing.sm },
  input: {
    height: 50, backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
  },
  inputError:     { borderColor: colors.danger, borderWidth: 1.5 },
  inputMultiline: { height: 72, paddingTop: spacing.md },
  inputPrefix: {
    flexDirection: 'row', alignItems: 'center',
    height: 50, backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingLeft: spacing.lg,
  },
  prefixText: { ...type.body, color: colors.textSecondary, marginRight: 2 },
  inputInner: {
    flex: 1, height: 50,
    ...type.body, color: colors.textPrimary,
    paddingRight: spacing.lg,
  },
  chipsWrap: { marginTop: 2 },
  chipsWrapContent: { flexDirection: 'row', gap: spacing.sm },

  saveBtn: {
    height: 52, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.lg,
  },
  saveBtnLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },
});
