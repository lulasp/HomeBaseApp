import React, { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import useFabHideOnScroll from '../../hooks/useFabHideOnScroll';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import FloatingActionButton from '../../components/FloatingActionButton';
import { M } from '../../components/Motion';
import { Easing } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import { useHousehold } from '../../context/HouseholdContext';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import {
  subscribeBills, addBill, updateBill, deleteBill, setBillMonthAmount, recordBillPayment,
  subscribeIncomeSources, addIncomeSource, updateIncomeSource, deleteIncomeSource, setIncomeMonthAmount,
  subscribeExpenses, addExpense, updateExpense, deleteExpense,
  subscribeBudgets, setBudget, deleteBudget,
  getHousehold,
} from '../../services/firestore';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import DatePickerInput from '../../components/DatePickerInput';
import { BILL_CATS, EXPENSE_CATS, withCustomCats } from '../../utils/financeCategories';
import { cashFlow, monthlyTrend, budgetProgress } from '../../utils/financeSummary';
import {
  amountForMonth, billTypeOf, estimatedTotal, hasMonthOverride, incomeForMonth,
  isActiveInMonth, isEstimate, isRecurringBill, payableBills, recurringTotal, shiftMonth, withRecurring,
} from '../../utils/recurring';

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

// Compact form for tight spaces (chart labels, summary cards): $1.2k, $980.
function fmtCompact(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${Math.round(v)}`;
}

// Money spent by an expense — income rows (direction 'in') don't count toward spend totals.
function spentAmount(e) {
  return e.direction === 'in' ? 0 : Number(e.amount || 0);
}

function fmtMonthGroup(key) {
  const [yr, mo] = key.split('-');
  return format(new Date(Number(yr), Number(mo) - 1, 1), 'MMMM yyyy');
}

const BLANK_BILL    = { name: '', category: 'other', billType: 'fixed', amount: '', dueDayOfMonth: '', notes: '' };
const BILL_TYPES    = [['fixed', 'Same amount'], ['variable', 'Varies'], ['once', 'One time']];
const BILL_AMOUNT_LABEL = { fixed: 'Monthly amount *', variable: 'Estimated amount *', once: 'Amount *' };
const BILL_TYPE_HINT = {
  fixed:    'Repeats every month automatically.',
  variable: 'Repeats every month. Enter each month\'s real amount with the calendar button; until then totals use your last amount.',
  once:     'Only applies to the month you\'re viewing.',
};
const blankExpense  = () => ({
  title: '', category: 'other', amount: '',
  date: format(new Date(), 'yyyy-MM-dd'), paidBy: '', billId: '', notes: '',
});
const blankIncome   = (date) => ({
  name: '', amount: '', ownerUid: null, recurring: true, date, notes: '',
});

// ── Animation helpers ────────────────────────────────────────────────────────────

// Staggered entrance — springs up + fades in, delayed by index. Replays whenever
// remounted (tab switch / screen focus, see contentKey below).
function Rise({ index = 0, style, children }) {
  return (
    <M
      from={{ opacity: 0, translateY: 22, scale: 0.98 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{ type: 'spring', damping: 16, stiffness: 150, mass: 0.9, delay: index * 55 }}
      style={style}
    >
      {children}
    </M>
  );
}

// Progress bar that grows from 0 to `ratio` of its measured track width.
function AnimatedBar({ ratio, color, trackStyle, fillStyle, delay = 0 }) {
  const [w, setW] = useState(0);
  const r = Math.min(1, Math.max(0, ratio));
  return (
    <View style={trackStyle} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <M
        style={[fillStyle, { backgroundColor: color }]}
        from={{ width: 0 }}
        animate={{ width: w * r }}
        transition={{ type: 'timing', duration: 700, delay, easing: Easing.out(Easing.cubic) }}
      />
    </View>
  );
}

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
      {cat.emoji
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

const BillCard = memo(function BillCard({ bill, cats, monthKey, currentMonth, onEdit, onEditMonth, onDelete, onTogglePaid, colors, styles }) {
  const cat       = cats.find(c => c.key === bill.category) || cats[cats.length - 1];
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  const today     = new Date();
  const todayDay  = today.getDate();
  const isPaid    = bill.paidMonths?.includes(monthKey);
  const isCurrent = monthKey === currentMonth;
  const isPast    = monthKey < currentMonth;
  const isOverdue = !isPaid && (isPast || (isCurrent && bill.dueDayOfMonth < todayDay));
  const isDueSoon = !isPaid && isCurrent && !isOverdue && bill.dueDayOfMonth <= todayDay + 5;
  const adjusted  = hasMonthOverride(bill, monthKey);
  const billType  = billTypeOf(bill);
  const estimate  = isEstimate(bill, monthKey);
  const amountSub = billType === 'once' ? 'one time'
    : estimate ? 'estimate'
    : billType === 'variable' ? 'this month'
    : adjusted ? `usually ${fmtCurrency(bill.amount)}`
    : '/ month';

  const statusColor = isPaid ? colors.sage : isOverdue ? colors.danger : isDueSoon ? colors.amber : colors.textTertiary;
  const statusBg    = isPaid ? colors.sageSoft : isOverdue ? colors.dangerSoft : isDueSoon ? colors.amberSoft : colors.muted;
  const statusIcon  = isPaid ? 'checkmark-circle' : isOverdue ? 'alert-circle' : isDueSoon ? 'time' : 'calendar-outline';
  const statusLabel = isPaid ? 'Paid' : isPast ? 'Unpaid' : isOverdue ? 'Overdue' : isDueSoon ? 'Due soon' : `Due ${ordinal(bill.dueDayOfMonth)}`;

  const daysUntil = bill.dueDayOfMonth - todayDay;
  const daysText  = isPaid || !isCurrent
    ? `Due ${ordinal(bill.dueDayOfMonth)}${billType === 'once' ? '' : ' each month'}`
    : daysUntil === 0 ? 'Due today'
    : daysUntil < 0   ? `${Math.abs(daysUntil)}d overdue`
    : `in ${daysUntil}d`;
  const daysColor = isPaid ? colors.textTertiary : isOverdue ? colors.danger : isDueSoon ? colors.amber : colors.textTertiary;

  const year = Number(monthKey.slice(0, 4));

  return (
    <View style={styles.billCard}>
      <View style={[styles.billAccent, { backgroundColor: statusColor }]} />
      <View style={styles.billCardInner}>

        {/* Header: icon + name + amount */}
        <View style={styles.billCardHeader}>
          <View style={[styles.billCatIcon, { backgroundColor: iconColor + '22' }]}>
            {cat.emoji
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
              {fmtCurrency(amountForMonth(bill, monthKey))}
            </Text>
            <Text style={[styles.billCardAmountSub, estimate && { color: colors.amber }]}>{amountSub}</Text>
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
        {billType !== 'once' && <View style={styles.historyRow}>
          {MONTHS_SHORT.map((m, i) => {
            const mk    = `${year}-${String(i + 1).padStart(2, '0')}`;
            const paid  = bill.paidMonths?.includes(mk);
            const isCur = mk === monthKey;
            const fut   = mk > currentMonth;
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
        </View>}

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
              {isPaid ? (isCurrent ? 'Paid this month' : 'Paid') : 'Mark as paid'}
            </Text>
          </TouchableOpacity>
          {billType !== 'once' && (
            <TouchableOpacity
              onPress={() => onEditMonth('bill', bill)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Change amount for ${fmtMonthGroup(monthKey)}`}
            >
              <Ionicons name="calendar-outline" size={16} color={estimate ? colors.amber : adjusted ? colors.accent : colors.textTertiary} />
            </TouchableOpacity>
          )}
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

const ExpenseCard = memo(function ExpenseCard({ expense, cats, ownerLabel, onEdit, onDelete, colors, styles }) {
  const cat       = cats.find(c => c.key === expense.category) || cats[cats.length - 1];
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  const dateLabel = expense.date ? format(new Date(expense.date + 'T00:00:00'), 'MMM d, yyyy') : '';
  const isIncome  = expense.direction === 'in';
  const person    = ownerLabel || expense.paidBy;

  return (
    <View style={styles.expenseCard}>
      {/* Header: icon + info + amount */}
      <View style={styles.expCardHeader}>
        <View style={[styles.expCatIcon, { backgroundColor: iconColor + '22' }]}>
          {cat.emoji
            ? <Text style={styles.catEmoji}>{cat.icon}</Text>
            : <Ionicons name={cat.icon} size={20} color={iconColor} />
          }
        </View>
        <View style={styles.expCardInfo}>
          <Text style={styles.expCardTitle} numberOfLines={1}>{expense.title}</Text>
          <View style={styles.expCardMeta}>
            <Ionicons name="calendar-outline" size={11} color={colors.textTertiary} />
            <Text style={styles.expCardDate}>{dateLabel}</Text>
            {!!person && (
              <>
                <Text style={styles.expCardSep}>·</Text>
                <Ionicons name="person-outline" size={11} color={colors.textTertiary} />
                <Text style={styles.expCardPaidBy}>{person}</Text>
              </>
            )}
            {!!expense.billId && (
              <>
                <Text style={styles.expCardSep}>·</Text>
                <Ionicons name="link-outline" size={11} color={colors.textTertiary} />
                <Text style={styles.expCardPaidBy}>Bill payment</Text>
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

// ── Recurring income card ──────────────────────────────────────────────────────

const IncomeCard = memo(function IncomeCard({ source, monthKey, ownerLabel, onEdit, onEditMonth, onDelete, colors, styles }) {
  const adjusted = hasMonthOverride(source, monthKey);
  return (
    <View style={styles.expenseCard}>
      <View style={styles.expCardHeader}>
        <View style={[styles.expCatIcon, { backgroundColor: colors.sageSoft }]}>
          <Ionicons name="repeat" size={20} color={colors.sage} />
        </View>
        <View style={styles.expCardInfo}>
          <Text style={styles.expCardTitle} numberOfLines={1}>{source.name}</Text>
          <View style={styles.expCardMeta}>
            <Ionicons name="person-outline" size={11} color={colors.textTertiary} />
            <Text style={styles.expCardPaidBy}>{ownerLabel}</Text>
          </View>
        </View>
        <View style={styles.expCardRight}>
          <Text style={[styles.expCardAmount, { color: colors.sage }]}>
            +{fmtCurrency(amountForMonth(source, monthKey))}
          </Text>
          <Text style={styles.billCardAmountSub}>
            {adjusted ? `usually ${fmtCurrency(source.amount)}` : '/ month'}
          </Text>
        </View>
      </View>

      {!!source.notes && (
        <View style={styles.notesRow}>
          <Ionicons name="document-text-outline" size={12} color={colors.textTertiary} />
          <Text style={styles.notesText} numberOfLines={2}>{source.notes}</Text>
        </View>
      )}

      <View style={styles.expCardActions}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => onEditMonth('income', source)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={`Change amount for ${fmtMonthGroup(monthKey)}`}
        >
          <Ionicons name="calendar-outline" size={16} color={adjusted ? colors.accent : colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onEdit(source)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(source)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ── Dropdown ────────────────────────────────────────────────────────────────────
// Opens inline: the expense form is already in a Modal. Tap the chosen option to
// clear it. A value with no matching option (an older free-text name, a deleted
// bill) shows `fallback` and isn't offered.

const Dropdown = memo(function Dropdown({ label, placeholder, emptyText, value, fallback, options, onChange, colors, styles }) {
  const [open, setOpen] = useState(false);
  const shown = value ? (options.find(o => o.value === value)?.label ?? fallback) : '';
  return (
    <View>
      <TouchableOpacity
        style={[styles.input, styles.dropdownBtn]}
        onPress={() => setOpen(o => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown || 'not set'}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.dropdownValue, !value && { color: colors.textTertiary }]} numberOfLines={1}>
          {shown || placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
      </TouchableOpacity>
      {open && (
        <View style={styles.dropdownList}>
          {options.length === 0 && <Text style={styles.dropdownEmpty}>{emptyText}</Text>}
          {options.map(option => {
            const selected = option.value === value;
            return (
              <TouchableOpacity
                key={option.value}
                style={styles.dropdownOption}
                onPress={() => { onChange(selected ? '' : option.value); setOpen(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.dropdownValue, selected && { color: colors.accent }]} numberOfLines={1}>{option.label}</Text>
                {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
});

// ── Month stepper (Bills and Income tabs) ───────────────────────────────────────

const MonthStepper = memo(function MonthStepper({ value, currentMonth, onChange, colors, styles }) {
  return (
    <View style={styles.monthStepper}>
      <TouchableOpacity
        onPress={() => onChange(shiftMonth(value, -1))}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
      >
        <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onChange(currentMonth)}
        disabled={value === currentMonth}
        accessibilityRole="button"
        accessibilityLabel={value === currentMonth ? fmtMonthGroup(value) : `${fmtMonthGroup(value)}, back to this month`}
      >
        <Text style={styles.monthStepperLabel}>{fmtMonthGroup(value)}</Text>
        {value !== currentMonth && <Text style={styles.monthStepperHint}>Back to this month</Text>}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onChange(shiftMonth(value, 1))}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Next month"
      >
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
});

// ── Spending trend (dependency-free View bars) ───────────────────────────────────

const CHART_H = 130;

const TrendChart = memo(function TrendChart({ data, colors, styles }) {
  const max        = Math.max(1, ...data.map(d => d.spending));
  const currentKey = data.length ? data[data.length - 1].key : null;
  return (
    <View style={styles.chartCard}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>Spending trend</Text>
        <Text style={styles.cardHint}>Last {data.length} months</Text>
      </View>
      <View style={styles.chartBars}>
        {data.map((d, i) => {
          const isCur = d.key === currentKey;
          const h     = d.spending > 0 ? Math.max(3, Math.round((d.spending / max) * CHART_H)) : 0;
          return (
            <View key={d.key} style={styles.chartCol}>
              <Text style={styles.chartValue} numberOfLines={1}>
                {d.spending > 0 ? fmtCompact(d.spending) : ''}
              </Text>
              <View style={styles.chartTrack}>
                <M
                  style={[styles.chartBar, { backgroundColor: isCur ? colors.accent : colors.muted }]}
                  from={{ height: 0 }}
                  animate={{ height: h }}
                  transition={{ type: 'spring', damping: 15, stiffness: 130, mass: 0.8, delay: 150 + i * 45 }}
                />
              </View>
              <Text style={[styles.chartLabel, isCur && { color: colors.textPrimary, fontWeight: '700' }]}>
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
});

// ── Budget progress row ──────────────────────────────────────────────────────────

const BudgetRow = memo(function BudgetRow({ row, cat, colors, styles, onEdit, onDelete }) {
  const iconColor = colors[cat.colorKey] || colors.textSecondary;
  const pct       = Math.min(1, row.ratio);
  const barColor  = row.over ? colors.danger : row.ratio >= 0.8 ? colors.amber : colors.sage;
  return (
    <View style={styles.budgetCard}>
      <View style={styles.budgetTop}>
        <View style={[styles.expCatIcon, { backgroundColor: iconColor + '22' }]}>
          {cat.emoji
            ? <Text style={styles.catEmoji}>{cat.icon}</Text>
            : <Ionicons name={cat.icon} size={20} color={iconColor} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.budgetName} numberOfLines={1}>{cat.label}</Text>
          <Text style={styles.budgetSub}>{fmtCurrency(row.spent)} of {fmtCurrency(row.budget)}</Text>
        </View>
        <Text style={[styles.budgetRemain, { color: row.over ? colors.danger : colors.sage }]}>
          {row.over ? `${fmtCurrency(-row.remaining)} over` : `${fmtCurrency(row.remaining)} left`}
        </Text>
      </View>

      <AnimatedBar
        ratio={pct}
        color={barColor}
        trackStyle={styles.progressTrack}
        fillStyle={styles.progressFill}
        delay={120}
      />

      <View style={styles.budgetActions}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => onEdit(row.category)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(row.category)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function BillsExpensesScreen({ navigation }) {
  const { householdId } = useAuth();
  const { colors }    = useTheme();
  const { showConfirm } = useAlert();
  const isDesktop     = useIsDesktop();
  const windowHeight = useVisualViewportHeight();
  const fab           = useFabHideOnScroll();
  const styles        = useMemo(() => makeStyles(colors), [colors]);
  const navScrollProps = useNavScrollProps();
  const { animationsEnabled, privateData } = useHousehold();

  const [activeTab,       setActiveTab]       = useState('overview');
  const [bills,           setBills]           = useState([]);
  const [expenses,        setExpenses]        = useState([]);
  const [budgets,         setBudgets]         = useState([]);
  const [incomeSources,   setIncomeSources]   = useState([]);
  const [customBillCats,  setCustomBillCats]  = useState([]);
  const [customExpCats,   setCustomExpCats]   = useState([]);
  const [billOverrides,   setBillOverrides]   = useState(null);
  const [expOverrides,    setExpOverrides]    = useState(null);
  const [modalVisible,  setModalVisible]  = useState(false);
  const [modalType,     setModalType]     = useState('bill');
  const [editingId,     setEditingId]     = useState(null);
  const [billForm,      setBillForm]      = useState(BLANK_BILL);
  const [expenseForm,   setExpenseForm]   = useState(blankExpense());
  const [budgetForm,    setBudgetForm]    = useState({ category: 'other', amount: '' });
  const [incomeForm,    setIncomeForm]    = useState(blankIncome(format(new Date(), 'yyyy-MM-dd')));
  const [monthEdit,     setMonthEdit]     = useState(null);   // { kind, item, amount }
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);

  // Bump on every focus (skip the first — the mount already animates) to remount
  // the tab content and replay entrance animations. Same pattern as HomeScreen.
  const [contentKey, setContentKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      if (animationsEnabled) setContentKey((k) => k + 1);
    }, [animationsEnabled]),
  );

  const monthKey = useMemo(() => getMonthKey(), []);
  const [viewMonth, setViewMonth] = useState(monthKey);   // Bills and Income tabs

  useEffect(() => {
    if (!householdId) return;
    getHousehold(householdId).then(hh => {
      setCustomBillCats(hh?.billCustomCategories ?? []);
      setCustomExpCats(hh?.expenseCustomCategories ?? []);
      setBillOverrides(hh?.billCategoryOverrides ?? null);
      setExpOverrides(hh?.expenseCategoryOverrides ?? null);
    });
  }, [householdId]);

  const allBillCats    = useMemo(() => withCustomCats(BILL_CATS, customBillCats, billOverrides), [customBillCats, billOverrides]);
  const allExpenseCats = useMemo(() => withCustomCats(EXPENSE_CATS, customExpCats, expOverrides), [customExpCats, expOverrides]);

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

  useEffect(() => {
    if (!householdId) return;
    return subscribeBudgets(householdId, setBudgets);
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    return subscribeIncomeSources(householdId, (data) =>
      setIncomeSources(data.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    );
  }, [householdId]);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const viewBills      = useMemo(() => bills.filter(b => isActiveInMonth(b, viewMonth)), [bills, viewMonth]);
  const paidBills      = useMemo(() => viewBills.filter(b => b.paidMonths?.includes(viewMonth)), [viewBills, viewMonth]);
  const monthlyTotal   = useMemo(() => recurringTotal(viewBills, viewMonth), [viewBills, viewMonth]);
  const paidAmount     = useMemo(() => recurringTotal(paidBills, viewMonth), [paidBills, viewMonth]);
  const paidCount      = paidBills.length;
  const estimatedBills = useMemo(() => estimatedTotal(viewBills, viewMonth), [viewBills, viewMonth]);
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

  // ── Overview / budgets ──────────────────────────────────────────────────────

  // Recurring bills and income count in full for every month they're active,
  // paid or not, so the Overview shows the real monthly commitment.
  const flowRows  = useMemo(() => {
    const keys = monthlyTrend([], 6).map(b => b.key);
    return withRecurring(expenses, bills, incomeSources, keys);
  }, [expenses, bills, incomeSources]);
  const flow      = useMemo(() => cashFlow(flowRows, monthKey), [flowRows, monthKey]);
  const trend     = useMemo(() => monthlyTrend(flowRows, 6), [flowRows]);
  const hasActivity = expenses.length > 0 || bills.length > 0 || incomeSources.length > 0;
  const fixedBills = useMemo(() => recurringTotal(bills.filter(isRecurringBill), monthKey), [bills, monthKey]);
  const budgetCatById = useMemo(() => {
    const m = {};
    allExpenseCats.forEach(c => { m[c.key] = c; });
    return m;
  }, [allExpenseCats]);
  const budgetRows = useMemo(() => budgetProgress(budgets, expenses, monthKey), [budgets, expenses, monthKey]);
  const budgetTotals = useMemo(() => {
    const budgeted  = budgetRows.reduce((s, r) => s + r.budget, 0);
    const spent     = budgetRows.reduce((s, r) => s + r.spent, 0);
    return { budgeted, spent, remaining: budgeted - spent, overCount: budgetRows.filter(r => r.over).length };
  }, [budgetRows]);

  // ── Income ─────────────────────────────────────────────────────────────────

  const income = useMemo(() => incomeForMonth(incomeSources, expenses, viewMonth), [incomeSources, expenses, viewMonth]);
  const memberProfiles = privateData?.memberProfiles;
  const ownerOptions = useMemo(() => [
    { uid: null, label: 'Household' },
    ...Object.entries(memberProfiles || {}).map(([uid, p]) => ({ uid, label: p?.name || p?.email || 'Member' })),
  ], [memberProfiles]);
  const memberOptions = useMemo(() => ownerOptions.filter(o => o.uid).map(o => ({ value: o.label, label: o.label })), [ownerOptions]);
  const billOptions = useMemo(() => (
    payableBills(bills, expenseForm.date.substring(0, 7)).map(b => ({ value: b.id, label: b.name }))
  ), [bills, expenseForm.date]);
  const ownerLabel = useCallback((uid) => (
    ownerOptions.find(o => o.uid === (uid || null))?.label || 'Former member'
  ), [ownerOptions]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  const openNew = useCallback(() => {
    const t = activeTab === 'bills' ? 'bill'
      : activeTab === 'budgets' ? 'budget'
      : activeTab === 'income' ? 'income'
      : 'expense';
    setModalType(t);
    setEditingId(null);
    setBillForm(BLANK_BILL);
    setExpenseForm(blankExpense());
    setIncomeForm(blankIncome(viewMonth === monthKey ? format(new Date(), 'yyyy-MM-dd') : `${viewMonth}-01`));
    if (t === 'budget') {
      // Default to the first expense category that has no budget yet.
      const budgeted = new Set(budgets.map(b => b.category));
      const next = allExpenseCats.find(c => !budgeted.has(c.key)) || allExpenseCats[0];
      setBudgetForm({ category: next?.key || 'other', amount: '' });
    }
    setErrors({});
    setModalVisible(true);
  }, [activeTab, budgets, allExpenseCats, viewMonth, monthKey]);

  const openEditBudget = useCallback((category) => {
    const existing = budgets.find(b => b.category === category);
    setModalType('budget');
    setEditingId(category);   // budget doc id === category key
    setBudgetForm({ category, amount: String(existing?.amount ?? '') });
    setErrors({});
    setModalVisible(true);
  }, [budgets]);

  const openEditBill = useCallback((bill) => {
    setModalType('bill');
    setEditingId(bill.id);
    setBillForm({
      name:          bill.name          || '',
      category:      bill.category      || 'other',
      billType:      billTypeOf(bill),
      amount:        String(bill.amount || ''),
      dueDayOfMonth: String(bill.dueDayOfMonth || ''),
      notes:         bill.notes         || '',
    });
    setErrors({});
    setModalVisible(true);
  }, []);

  const openEditIncomeSource = useCallback((source) => {
    setModalType('income');
    setEditingId(source.id);
    setIncomeForm({
      name:      source.name || '',
      amount:    String(source.amount || ''),
      ownerUid:  source.ownerUid || null,
      recurring: true,
      date:      format(new Date(), 'yyyy-MM-dd'),
      notes:     source.notes || '',
    });
    setErrors({});
    setModalVisible(true);
  }, []);

  const openEditIncomeEntry = useCallback((entry) => {
    setModalType('income');
    setEditingId(entry.id);
    setIncomeForm({
      name:      entry.title || '',
      amount:    String(entry.amount || ''),
      ownerUid:  entry.ownerUid || null,
      recurring: false,
      date:      entry.date || format(new Date(), 'yyyy-MM-dd'),
      notes:     entry.notes || '',
    });
    setErrors({});
    setModalVisible(true);
  }, []);

  const openEditMonth = useCallback((kind, item) => {
    setModalType('month');
    setEditingId(item.id);
    setMonthEdit({ kind, item, amount: String(amountForMonth(item, viewMonth)) });
    setErrors({});
    setModalVisible(true);
  }, [viewMonth]);

  const openEditExpense = useCallback((expense) => {
    if (expense.direction === 'in') { openEditIncomeEntry(expense); return; }
    setModalType('expense');
    setEditingId(expense.id);
    setExpenseForm({
      title:    expense.title    || '',
      category: expense.category || 'other',
      amount:   String(expense.amount || ''),
      date:     expense.date     || format(new Date(), 'yyyy-MM-dd'),
      paidBy:   expense.paidBy   || '',
      billId:   expense.billId   || '',
      notes:    expense.notes    || '',
    });
    setErrors({});
    setModalVisible(true);
  }, [openEditIncomeEntry]);

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
        billType: billForm.billType,
        amount: Number(billForm.amount),
        dueDayOfMonth: day,
        notes: billForm.notes.trim(),
      };
      // A bill turned into a one-time bill belongs to the month being viewed.
      const wasOnce = billTypeOf(bills.find(b => b.id === editingId) || {}) === 'once';
      if (editingId) await updateBill(householdId, editingId, data.billType === 'once' && !wasOnce ? { ...data, startMonth: viewMonth } : data);
      else           await addBill(householdId, { ...data, startMonth: viewMonth });
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [billForm, bills, editingId, householdId, closeModal, viewMonth]);

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
        billId:   expenseForm.billId || null,
        notes:    expenseForm.notes.trim(),
      };
      if (editingId) await updateExpense(householdId, editingId, data);
      else           await addExpense(householdId, data);
      const bill = bills.find(b => b.id === data.billId);
      if (bill) await recordBillPayment(householdId, bill, data.date.substring(0, 7), data.amount);
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [expenseForm, bills, editingId, householdId, closeModal]);

  const handleSaveIncome = useCallback(async () => {
    const errs = {};
    if (!incomeForm.name.trim()) errs.name = true;
    if (!incomeForm.amount || isNaN(Number(incomeForm.amount))) errs.amount = true;
    if (!incomeForm.recurring && !incomeForm.date) errs.date = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      const amount = Number(incomeForm.amount);
      const shared = { amount, ownerUid: incomeForm.ownerUid, notes: incomeForm.notes.trim() };
      const name   = incomeForm.name.trim();
      if (incomeForm.recurring) {
        const data = { ...shared, name };
        if (editingId) await updateIncomeSource(householdId, editingId, data);
        else           await addIncomeSource(householdId, { ...data, startMonth: viewMonth });
      } else {
        const data = { ...shared, title: name, date: incomeForm.date };
        if (editingId) await updateExpense(householdId, editingId, data);
        else           await addExpense(householdId, { ...data, category: 'other', paidBy: '', direction: 'in' });
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [incomeForm, editingId, householdId, closeModal, viewMonth]);

  const saveMonthAmount = useCallback(async (amount) => {
    const setAmount = monthEdit.kind === 'bill' ? setBillMonthAmount : setIncomeMonthAmount;
    setSaving(true);
    try {
      await setAmount(householdId, monthEdit.item.id, viewMonth, amount);
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [monthEdit, householdId, viewMonth, closeModal]);

  const handleSaveMonth = useCallback(() => {
    const raw = monthEdit?.amount ?? '';
    // 0 is valid: it skips the bill or income for this month.
    if (raw === '' || isNaN(Number(raw)) || Number(raw) < 0) { setErrors({ amount: true }); return; }
    saveMonthAmount(Number(raw));
  }, [monthEdit, saveMonthAmount]);

  const handleSaveBudget = useCallback(async () => {
    const errs = {};
    if (!budgetForm.amount || isNaN(Number(budgetForm.amount)) || Number(budgetForm.amount) <= 0) errs.amount = true;
    if (!budgetForm.category) errs.category = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSaving(true);
    try {
      await setBudget(householdId, budgetForm.category, Number(budgetForm.amount));
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [budgetForm, householdId, closeModal]);

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
      title: expense.direction === 'in' ? 'Delete income' : 'Delete expense',
      message: `Remove "${expense.title}"? This can't be undone.`,
      confirmLabel: 'Delete',
      type: 'danger',
    });
    if (ok) deleteExpense(householdId, expense.id);
  }, [householdId, showConfirm]);

  const handleDeleteIncomeSource = useCallback(async (source) => {
    const ok = await showConfirm({
      title: 'Delete income',
      message: `Remove "${source.name}" from every month? This can't be undone.`,
      confirmLabel: 'Delete',
      type: 'danger',
    });
    if (ok) deleteIncomeSource(householdId, source.id);
  }, [householdId, showConfirm]);

  const handleTogglePaid = useCallback((bill, key, isPaid) => {
    const next = isPaid
      ? (bill.paidMonths || []).filter(m => m !== key)
      : [...(bill.paidMonths || []), key];
    updateBill(householdId, bill.id, { paidMonths: next });
  }, [householdId]);

  const handleDeleteBudget = useCallback(async (category) => {
    const cat = budgetCatById[category];
    const ok = await showConfirm({
      title: 'Remove budget',
      message: `Remove the budget for "${cat?.label || category}"?`,
      confirmLabel: 'Remove',
      type: 'danger',
    });
    if (ok) deleteBudget(householdId, category);
  }, [householdId, showConfirm, budgetCatById]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[
      styles.root,
      // Web: a ScrollView only scrolls with a definite-height ancestor; the
      // Stack card's height doesn't propagate through flex:1 on react-native-web.
      // Matches ProfileScreen, which scrolls correctly in the same nav stack.
      Platform.OS === 'web' ? { height: windowHeight } : null,
      Platform.OS === 'android' && { paddingTop: 24 },
    ]}>
      {/* Content column — also the box the FAB anchors its corners to, so the
          button stays with the page instead of the full-width scene (Pantry). */}
      <View style={[
        styles.contentWrapper,
        isDesktop && styles.contentWrapperDesktop,
        Platform.OS === 'web' ? { height: windowHeight } : null,
      ]}>
        <ScrollView
          // Web: explicit pixel height (not flex:1) so the scroll container has a
          // real, bounded height instead of growing to fit all content. Same fix
          // that made StatementImportScreen scroll.
          style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
          contentContainerStyle={styles.container}
          onScroll={(e) => { navScrollProps.onScroll(e); fab.onScroll(e); }}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Finances</Text>
              <Text style={styles.subtitle}>Cash flow, budgets & bills</Text>
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
            {[['overview', 'Overview'], ['bills', 'Bills'], ['income', 'Income'], ['expenses', 'Expenses'], ['budgets', 'Budgets']].map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.tabBtn, activeTab === key && styles.tabBtnActive]}
                onPress={() => setActiveTab(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === key }}
              >
                <Text
                  style={[styles.tabBtnLabel, activeTab === key && styles.tabBtnLabelActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab content — keyed so it remounts and replays entrance anims on focus */}
          <View key={contentKey}>
          {/* ── Overview tab ──────────────────────────────────────────────── */}
          {activeTab === 'overview' && !hasActivity && (
            <View style={styles.emptyState}>
              <Ionicons name="stats-chart-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptySub}>Add bills, income or expenses, or import a statement, to see your cash flow and trends.</Text>
            </View>
          )}

          {activeTab === 'overview' && hasActivity && (
            <>
              {/* Cash-flow hero */}
              <Rise index={0}>
              <View style={styles.flowCard}>
                <Text style={styles.flowLabel}>Net this month</Text>
                <Text style={[styles.flowNet, { color: flow.net >= 0 ? colors.sage : colors.danger }]}>
                  {flow.net >= 0 ? '' : '−'}{fmtCurrency(Math.abs(flow.net))}
                </Text>
                <View style={styles.flowRow}>
                  <View style={styles.flowStat}>
                    <View style={styles.flowStatHead}>
                      <Ionicons name="arrow-down-circle" size={14} color={colors.sage} />
                      <Text style={styles.flowStatLabel}>Money in</Text>
                    </View>
                    <Text style={[styles.flowStatValue, { color: colors.sage }]}>{fmtCurrency(flow.income)}</Text>
                  </View>
                  <View style={styles.flowDivider} />
                  <View style={styles.flowStat}>
                    <View style={styles.flowStatHead}>
                      <Ionicons name="arrow-up-circle" size={14} color={colors.amber} />
                      <Text style={styles.flowStatLabel}>Money out</Text>
                    </View>
                    <Text style={[styles.flowStatValue, { color: colors.amber }]}>{fmtCurrency(flow.spending)}</Text>
                  </View>
                  <View style={styles.flowDivider} />
                  <View style={styles.flowStat}>
                    <View style={styles.flowStatHead}>
                      <Ionicons name="pie-chart" size={13} color={colors.textSecondary} />
                      <Text style={styles.flowStatLabel}>Saved</Text>
                    </View>
                    <Text style={styles.flowStatValue}>
                      {flow.income > 0 ? `${Math.round(flow.savingsRate * 100)}%` : '—'}
                    </Text>
                  </View>
                </View>
                {fixedBills > 0 && (
                  <Text style={styles.flowFootnote}>Includes {fmtCurrency(fixedBills)} in recurring bills</Text>
                )}
              </View>
              </Rise>

              {/* Spending trend */}
              <Rise index={1}>
                <TrendChart data={trend} colors={colors} styles={styles} />
              </Rise>
            </>
          )}

          {/* ── Bills tab ─────────────────────────────────────────────────── */}
          {activeTab === 'bills' && (
            <>
              {bills.length > 0 && (
                <MonthStepper value={viewMonth} currentMonth={monthKey} onChange={setViewMonth} colors={colors} styles={styles} />
              )}

              {viewBills.length > 0 && (
                <Rise index={0} style={styles.summaryRow}>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{fmtCurrency(monthlyTotal)}</Text>
                    <Text style={styles.summaryLabel}>Total</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryValue, { color: colors.sage }]}>{fmtCurrency(paidAmount)}</Text>
                    <Text style={styles.summaryLabel}>Paid {paidCount}/{viewBills.length}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryValue, { color: outstanding > 0 ? colors.danger : colors.sage }]}>
                      {fmtCurrency(outstanding)}
                    </Text>
                    <Text style={styles.summaryLabel}>Outstanding</Text>
                  </View>
                </Rise>
              )}

              {estimatedBills > 0 && (
                <Text style={styles.estimateNote}>Includes {fmtCurrency(estimatedBills)} estimated</Text>
              )}

              {viewBills.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="receipt-outline" size={48} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>{bills.length ? 'No bills this month' : 'No bills yet'}</Text>
                  <Text style={styles.emptySub}>
                    {bills.length
                      ? 'None of your bills apply to this month.'
                      : 'Add your first recurring bill — rent, electricity, internet…'}
                  </Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {viewBills.map((bill, i) => (
                    <Rise key={bill.id} index={Math.min(i + 1, 8)}>
                      <BillCard
                        bill={bill}
                        cats={allBillCats}
                        monthKey={viewMonth}
                        currentMonth={monthKey}
                        onEdit={openEditBill}
                        onEditMonth={openEditMonth}
                        onDelete={handleDeleteBill}
                        onTogglePaid={handleTogglePaid}
                        colors={colors}
                        styles={styles}
                      />
                    </Rise>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Income tab ────────────────────────────────────────────────── */}
          {activeTab === 'income' && (
            <>
              <MonthStepper value={viewMonth} currentMonth={monthKey} onChange={setViewMonth} colors={colors} styles={styles} />

              {income.total > 0 && (
                <Rise index={0} style={styles.summaryRow}>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryValue, { color: colors.sage }]}>{fmtCurrency(income.total)}</Text>
                    <Text style={styles.summaryLabel}>Total</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{fmtCurrency(income.recurringTotal)}</Text>
                    <Text style={styles.summaryLabel}>Recurring</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{fmtCurrency(income.oneOffTotal)}</Text>
                    <Text style={styles.summaryLabel}>One-off</Text>
                  </View>
                </Rise>
              )}

              {income.byOwner.length > 1 && (
                <Rise index={1}>
                  <View style={styles.ownerCard}>
                    {income.byOwner.map(o => (
                      <View key={o.ownerUid || 'household'} style={styles.ownerRow}>
                        <Text style={styles.ownerName} numberOfLines={1}>{ownerLabel(o.ownerUid)}</Text>
                        <Text style={styles.ownerAmount}>{fmtCurrency(o.amount)}</Text>
                      </View>
                    ))}
                  </View>
                </Rise>
              )}

              {income.recurring.length === 0 && income.oneOff.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="wallet-outline" size={48} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>No income this month</Text>
                  <Text style={styles.emptySub}>Add a monthly salary once, or a one-off payment.</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {income.recurring.map((source, i) => (
                    <Rise key={source.id} index={Math.min(i + 2, 8)}>
                      <IncomeCard
                        source={source}
                        monthKey={viewMonth}
                        ownerLabel={ownerLabel(source.ownerUid)}
                        onEdit={openEditIncomeSource}
                        onEditMonth={openEditMonth}
                        onDelete={handleDeleteIncomeSource}
                        colors={colors}
                        styles={styles}
                      />
                    </Rise>
                  ))}
                  {income.oneOff.map((entry, i) => (
                    <Rise key={entry.id} index={Math.min(i + 2, 8)}>
                      <ExpenseCard
                        expense={entry}
                        cats={allExpenseCats}
                        ownerLabel={ownerLabel(entry.ownerUid)}
                        onEdit={openEditIncomeEntry}
                        onDelete={handleDeleteExpense}
                        colors={colors}
                        styles={styles}
                      />
                    </Rise>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Expenses tab ──────────────────────────────────────────────── */}
          {activeTab === 'expenses' && (
            <>
              {expenses.length > 0 && (
                <Rise index={0} style={[styles.summaryRow, { gap: spacing.md }]}>
                  <View style={[styles.summaryCard, { flex: 1 }]}>
                    <Text style={[styles.summaryValue, { color: colors.amber }]}>{fmtCurrency(thisMonthTotal)}</Text>
                    <Text style={styles.summaryLabel}>This month</Text>
                  </View>
                  <View style={[styles.summaryCard, { flex: 1 }]}>
                    <Text style={styles.summaryValue}>{fmtCurrency(thisYearTotal)}</Text>
                    <Text style={styles.summaryLabel}>This year</Text>
                  </View>
                </Rise>
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
                      {items.map((expense, i) => (
                        <Rise key={expense.id} index={Math.min(i + 1, 8)}>
                          <ExpenseCard
                            expense={expense}
                            cats={allExpenseCats}
                            onEdit={openEditExpense}
                            onDelete={handleDeleteExpense}
                            colors={colors}
                            styles={styles}
                          />
                        </Rise>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Budgets tab ───────────────────────────────────────────────── */}
          {activeTab === 'budgets' && (
            <>
              {budgetRows.length > 0 && (
                <Rise index={0} style={styles.summaryRow}>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryValue}>{fmtCurrency(budgetTotals.budgeted)}</Text>
                    <Text style={styles.summaryLabel}>Budgeted</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryValue, { color: colors.amber }]}>{fmtCurrency(budgetTotals.spent)}</Text>
                    <Text style={styles.summaryLabel}>Spent</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={[styles.summaryValue, { color: budgetTotals.remaining < 0 ? colors.danger : colors.sage }]}>
                      {fmtCurrency(budgetTotals.remaining)}
                    </Text>
                    <Text style={styles.summaryLabel}>
                      {budgetTotals.overCount > 0 ? `${budgetTotals.overCount} over` : 'Left'}
                    </Text>
                  </View>
                </Rise>
              )}

              {budgetRows.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="wallet-outline" size={48} color={colors.textTertiary} />
                  <Text style={styles.emptyTitle}>No budgets yet</Text>
                  <Text style={styles.emptySub}>Set a monthly limit per category and track spending against it.</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {budgetRows.map((row, i) => (
                    <Rise key={row.category} index={Math.min(i + 1, 8)}>
                      <BudgetRow
                        row={row}
                        cat={budgetCatById[row.category] || { key: row.category, label: row.category, icon: 'cash', colorKey: 'textSecondary' }}
                        colors={colors}
                        styles={styles}
                        onEdit={openEditBudget}
                        onDelete={handleDeleteBudget}
                      />
                    </Rise>
                  ))}
                </View>
              )}
            </>
          )}

          </View>
          <View style={{ height: 230 }} />
        </ScrollView>

        {/* FAB */}
        <FloatingActionButton
          onPress={openNew}
          accessibilityLabel={`Add ${activeTab === 'bills' ? 'bill' : activeTab === 'budgets' ? 'budget' : activeTab === 'income' ? 'income' : 'expense'}`}
          hideAnim={fab.hideAnim}
          interactive={fab.interactive}
        />
      </View>

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
                {modalType === 'month'
                  ? `${monthEdit?.item.name} · ${fmtMonthGroup(viewMonth)}`
                  : modalType === 'income'
                  ? (editingId ? 'Edit Income' : 'Add Income')
                  : modalType === 'bill'
                  ? (editingId ? 'Edit Bill' : 'Add Bill')
                  : modalType === 'budget'
                    ? (editingId ? 'Edit Budget' : 'Add Budget')
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
              {modalType === 'month' ? (
                <>
                  <Text style={styles.fieldLabel}>Amount for {fmtMonthGroup(viewMonth)} *</Text>
                  <View style={[styles.inputPrefix, errors.amount && styles.inputError]}>
                    <Text style={styles.prefixText}>$</Text>
                    <TextInput
                      style={styles.inputInner}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      value={monthEdit?.amount ?? ''}
                      onChangeText={v => { setMonthEdit(m => ({ ...m, amount: v })); setErrors(e => ({ ...e, amount: false })); }}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <Text style={styles.helperText}>
                    {monthEdit && billTypeOf(monthEdit.item) === 'variable'
                      ? 'Only changes this month. Later months use it as their estimate. Enter 0 to skip this month.'
                      : `Only changes this month. The usual amount is ${fmtCurrency(monthEdit?.item.amount)}. Enter 0 to skip this month.`}
                  </Text>
                  {!!monthEdit && hasMonthOverride(monthEdit.item, viewMonth) && (
                    <TouchableOpacity
                      style={styles.resetBtn}
                      onPress={() => saveMonthAmount(null)}
                      disabled={saving}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.resetBtnLabel, { color: colors.accent }]}>
                        {billTypeOf(monthEdit.item) === 'variable' ? 'Use the estimate' : 'Use the usual amount'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : modalType === 'income' ? (
                <>
                  {!editingId && (
                    <View style={styles.segmentRow}>
                      {[[true, 'Every month'], [false, 'One time']].map(([value, label]) => (
                        <TouchableOpacity
                          key={label}
                          style={[styles.segmentBtn, incomeForm.recurring === value && styles.tabBtnActive]}
                          onPress={() => setIncomeForm(f => ({ ...f, recurring: value }))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: incomeForm.recurring === value }}
                        >
                          <Text style={[styles.tabBtnLabel, incomeForm.recurring === value && styles.tabBtnLabelActive]}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <Text style={styles.fieldLabel}>Name *</Text>
                  <TextInput
                    style={[styles.input, errors.name && styles.inputError]}
                    placeholder={incomeForm.recurring ? 'e.g. Salary' : 'e.g. Bonus'}
                    placeholderTextColor={colors.textTertiary}
                    value={incomeForm.name}
                    onChangeText={v => { setIncomeForm(f => ({ ...f, name: v })); setErrors(e => ({ ...e, name: false })); }}
                  />

                  <Text style={styles.fieldLabel}>{incomeForm.recurring ? 'Monthly amount *' : 'Amount *'}</Text>
                  <View style={[styles.inputPrefix, errors.amount && styles.inputError]}>
                    <Text style={styles.prefixText}>$</Text>
                    <TextInput
                      style={styles.inputInner}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      value={incomeForm.amount}
                      onChangeText={v => { setIncomeForm(f => ({ ...f, amount: v })); setErrors(e => ({ ...e, amount: false })); }}
                      keyboardType="decimal-pad"
                    />
                  </View>

                  {!incomeForm.recurring && (
                    <>
                      <Text style={styles.fieldLabel}>Date *</Text>
                      <DatePickerInput
                        value={incomeForm.date}
                        onChange={v => { setIncomeForm(f => ({ ...f, date: v })); setErrors(e => ({ ...e, date: false })); }}
                        hasError={!!errors.date}
                      />
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Whose income</Text>
                  <View style={styles.ownerChips}>
                    {ownerOptions.map(o => {
                      const selected = incomeForm.ownerUid === o.uid;
                      return (
                        <TouchableOpacity
                          key={o.uid || 'household'}
                          style={[styles.ownerChip, selected && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}
                          onPress={() => setIncomeForm(f => ({ ...f, ownerUid: o.uid }))}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.ownerChipLabel, selected && { color: colors.accent }]}>{o.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldLabel}>Notes</Text>
                  <TextInput
                    style={[styles.input, styles.inputMultiline]}
                    placeholder="Optional"
                    placeholderTextColor={colors.textTertiary}
                    value={incomeForm.notes}
                    onChangeText={v => setIncomeForm(f => ({ ...f, notes: v }))}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                  />
                </>
              ) : modalType === 'budget' ? (
                <>
                  <Text style={styles.fieldLabel}>Category</Text>
                  {editingId ? (
                    <View style={styles.budgetCatStatic}>
                      <Text style={styles.budgetCatStaticText}>
                        {(budgetCatById[budgetForm.category] || {}).label || budgetForm.category}
                      </Text>
                    </View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsWrapContent}>
                      {allExpenseCats.map(cat => (
                        <CatChip
                          key={cat.key}
                          cat={cat}
                          selected={budgetForm.category === cat.key}
                          onSelect={v => setBudgetForm(f => ({ ...f, category: v }))}
                          colors={colors}
                        />
                      ))}
                    </ScrollView>
                  )}

                  <Text style={styles.fieldLabel}>Monthly limit *</Text>
                  <View style={[styles.inputPrefix, errors.amount && styles.inputError]}>
                    <Text style={styles.prefixText}>$</Text>
                    <TextInput
                      style={styles.inputInner}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      value={budgetForm.amount}
                      onChangeText={v => { setBudgetForm(f => ({ ...f, amount: v })); setErrors(e => ({ ...e, amount: false })); }}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <Text style={styles.helperText}>Applies every month. Track it on the Budgets tab.</Text>
                </>
              ) : modalType === 'bill' ? (
                <>
                  <View style={styles.segmentRow}>
                    {BILL_TYPES.map(([value, label]) => (
                      <TouchableOpacity
                        key={value}
                        style={[styles.segmentBtn, billForm.billType === value && styles.tabBtnActive]}
                        onPress={() => setBillForm(f => ({ ...f, billType: value }))}
                        accessibilityRole="button"
                        accessibilityState={{ selected: billForm.billType === value }}
                      >
                        <Text style={[styles.tabBtnLabel, billForm.billType === value && styles.tabBtnLabelActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.helperText}>{BILL_TYPE_HINT[billForm.billType]}</Text>

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

                  <Text style={styles.fieldLabel}>{BILL_AMOUNT_LABEL[billForm.billType]}</Text>
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
                  <Dropdown
                    label="Paid by"
                    placeholder="Select a member"
                    emptyText="No household members found"
                    value={expenseForm.paidBy}
                    fallback={expenseForm.paidBy}
                    options={memberOptions}
                    onChange={v => setExpenseForm(f => ({ ...f, paidBy: v }))}
                    colors={colors}
                    styles={styles}
                  />

                  <Text style={styles.fieldLabel}>Bill payment</Text>
                  <Dropdown
                    label="Bill payment"
                    placeholder="Not a bill payment"
                    emptyText="No bills yet"
                    value={expenseForm.billId}
                    fallback="Deleted bill"
                    options={billOptions}
                    onChange={v => setExpenseForm(f => ({ ...f, billId: v }))}
                    colors={colors}
                    styles={styles}
                  />
                  {!!expenseForm.billId && (
                    <Text style={styles.helperText}>
                      Marks the bill paid for this month with this amount. The Overview counts it once, as the bill.
                    </Text>
                  )}

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
                onPress={
                  modalType === 'month' ? handleSaveMonth
                    : modalType === 'income' ? handleSaveIncome
                    : modalType === 'bill' ? handleSaveBill
                    : modalType === 'budget' ? handleSaveBudget
                    : handleSaveExpense
                }
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
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const makeStyles = (colors) => StyleSheet.create({
  root:      { flex: 1, minHeight: 0, backgroundColor: colors.background },
  contentWrapper:        { flex: 1, minHeight: 0 },
  contentWrapperDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
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
  tabBtnLabel:       { ...type.bodyMed, color: colors.textTertiary, fontSize: 13 },
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

  // ── Overview: cash-flow hero ──────────────────────────────────────────────
  flowCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, marginBottom: spacing.lg, alignItems: 'center',
  },
  flowLabel:     { ...type.label, color: colors.textTertiary, marginBottom: 4 },
  flowNet:       { fontSize: 34, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  flowRow:       { flexDirection: 'row', alignSelf: 'stretch', marginTop: spacing.lg },
  flowStat:      { flex: 1, alignItems: 'center', gap: 4 },
  flowStatHead:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flowStatLabel: { ...type.caption, color: colors.textTertiary },
  flowStatValue: { ...type.bodyMed, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  flowDivider:   { width: 1, backgroundColor: colors.border, marginVertical: 2 },
  flowFootnote:  { ...type.caption, color: colors.textTertiary, marginTop: spacing.md, textAlign: 'center' },

  // ── Month stepper ─────────────────────────────────────────────────────────
  monthStepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  monthStepperLabel: { ...type.bodyMed, color: colors.textPrimary, textAlign: 'center' },
  monthStepperHint:  { ...type.caption, color: colors.accent, textAlign: 'center' },

  // ── Income ────────────────────────────────────────────────────────────────
  ownerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg,
  },
  ownerRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  ownerName:   { ...type.body, color: colors.textSecondary, flex: 1 },
  ownerAmount: { ...type.bodyMed, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  ownerChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
  ownerChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
  },
  ownerChipLabel: { ...type.bodySm, color: colors.textSecondary, fontWeight: '600' },
  segmentRow: {
    flexDirection: 'row', backgroundColor: colors.muted,
    borderRadius: radius.lg, padding: 3,
  },
  segmentBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.md },
  resetBtn:      { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  resetBtnLabel: { ...type.bodySm, fontWeight: '700' },

  // ── Overview: trend chart ─────────────────────────────────────────────────
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  cardTitle:     { ...type.h4, color: colors.textPrimary },
  cardHint:      { ...type.caption, color: colors.textTertiary },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  chartBars:  { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: CHART_H + 40 },
  chartCol:   { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  chartValue: { ...type.caption, color: colors.textTertiary, fontSize: 9, fontVariant: ['tabular-nums'] },
  chartTrack: { height: CHART_H, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  chartBar:   { width: '70%', maxWidth: 34, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  chartLabel: { ...type.caption, color: colors.textTertiary },

  // ── Budgets ───────────────────────────────────────────────────────────────
  budgetCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.sm,
  },
  budgetTop:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  budgetName:   { ...type.bodyMed, color: colors.textPrimary },
  budgetSub:    { ...type.caption, color: colors.textTertiary, marginTop: 2, fontVariant: ['tabular-nums'] },
  budgetRemain: { ...type.bodySm, fontWeight: '700', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 8, borderRadius: radius.full, backgroundColor: colors.muted, overflow: 'hidden' },
  progressFill:  { height: 8, borderRadius: radius.full },
  budgetActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  budgetCatStatic: {
    height: 50, justifyContent: 'center', paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  budgetCatStaticText: { ...type.body, color: colors.textPrimary },
  helperText: { ...type.caption, color: colors.textTertiary, marginTop: spacing.sm },
  estimateNote: { ...type.caption, color: colors.amber, textAlign: 'center', marginTop: -spacing.lg, marginBottom: spacing.lg },

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
  dropdownBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  dropdownValue: { ...type.body, color: colors.textPrimary, flexShrink: 1 },
  dropdownEmpty: { ...type.bodySm, color: colors.textTertiary, padding: spacing.md },
  dropdownList: {
    marginTop: spacing.xs, backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  dropdownOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    minHeight: 44, paddingHorizontal: spacing.lg,
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
