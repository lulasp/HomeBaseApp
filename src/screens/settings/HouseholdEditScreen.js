import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Platform, Modal, KeyboardAvoidingView, AccessibilityInfo, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import {
  getHouseholdWithPrivate, updateHouseholdName, leaveHousehold, removeHouseholdMember,
  regenerateInviteCode, transferHouseholdOwnership, updateHouseholdPantryCategories,
  updateHouseholdNonFoodCategories, updateHouseholdFinanceCategories, updateHouseholdGoveeApiKey,
  updateHouseholdOpenRouterApiKey, updateHouseholdAiModel,
  updateHouseholdUnits, upsertMemberProfile, updateHouseholdXiaomiCreds, updateHouseholdIntegrationFlags,
  updateHouseholdReduceMotion,
  subscribeEmergencyContacts, addEmergencyContact, updateEmergencyContact, deleteEmergencyContact,
} from '../../services/firestore';
import { saveCredentials as saveXiaomiCredentials } from '../../services/xiaomi';
import { Rise } from '../../components/Motion';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS } from '../../utils/categories';
import { AI_MODELS, DEFAULT_AI_MODEL } from '../../utils/aiModels';
import DraggableCategoryList from '../../components/DraggableCategoryList';
import IconPicker from '../../components/IconPicker';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';

const CONTACT_ICONS  = ['🚑','🏥','👨‍⚕️','🚒','🚓','👮','💊','🧑‍🚒','👨‍👩‍👧','👴','🏠','🔑','🌐','📞','⚡','🐾'];
const RELATIONSHIPS  = ['Doctor','Hospital','Police','Fire Dept','Family','Neighbor','Vet','Electrician','Plumber','Other'];
const CATEGORY_ICONS = ['📦','🥩','🥦','🥕','🍎','🥚','🧈','🍞','🥐','🫙','🧃','🍫','🌽','🥥','🫒','🍄','🧁','🧂','🫚','🌶️','🧄','🧅','🍋','🫐','🍓','🥑','🌮','🍜','🫕','🥘','🧆','🛒','🏪'];
const FINANCE_ICONS  = ['💡','🔥','💧','📡','📱','🚗','🐕','🐈','🏥','🎓','🛒','🔧','🧹','🛋️','📺','🧺','🍽️','🎭','🎾','⛽','💳','📄','💊','🧾','🎸','🎮','🎬','✈️','🌿','🎁','🏋️','🎨','🧴','🪴','🏡'];

const BLANK_CONTACT = { icon: '📞', name: '', phone: '', relationship: '', notes: '' };
const BLANK_CAT = { label: '', icon: '📦' };

const XIAOMI_REGIONS = [
  { key: 'cn', label: 'China' }, { key: 'us', label: 'US' }, { key: 'eu', label: 'Europe' },
  { key: 'ru', label: 'Russia' }, { key: 'sg', label: 'Singapore' }, { key: 'in', label: 'India' },
  { key: 'de', label: 'Germany' }, { key: 'tw', label: 'Taiwan' },
];
const BLANK_XIAOMI = { userId: '', serviceToken: '', ssecurity: '', region: 'cn' };

const applyOrder = (all, order) => {
  if (!order.length) return all;
  const map = new Map(order.map((label, i) => [label, i]));
  return [...all].sort((a, b) => (map.get(a.label) ?? 999) - (map.get(b.label) ?? 999));
};

// Collapsible cluster of related sections. `action` renders on the right of the
// header (e.g. an Add button) and is independent of the collapse toggle.
function CollapsibleGroup({ title, icon, open, onToggle, action, styles, colors, children }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <TouchableOpacity
          style={styles.groupHeaderMain}
          onPress={onToggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
        >
          <View style={styles.groupIconRing}>
            <Ionicons name={icon} size={16} color={colors.accent} />
          </View>
          <Text style={styles.groupTitle}>{title}</Text>
        </TouchableOpacity>
        <View style={styles.groupHeaderRight}>
          {action}
          <TouchableOpacity
            onPress={onToggle}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`${open ? 'Collapse' : 'Expand'} ${title}`}
          >
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>
      {open && <View style={styles.groupBody}>{children}</View>}
    </View>
  );
}

export default function HouseholdEditScreen({ route, navigation }) {
  const { householdId: hhId } = route.params;
  const { user, removeHousehold } = useAuth();
  const { colors } = useTheme();
  const { showAlert, showConfirm, showOptions } = useAlert();
  const { notify } = useNotification();

  const styles    = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const insets    = useSafeAreaInsets();
  const windowHeight = useVisualViewportHeight();

  const [household, setHousehold]           = useState(null);
  const [loading, setLoading]               = useState(true);
  const [loadError, setLoadError]           = useState(null);
  const [navBarH, setNavBarH]               = useState(0);
  const [footerH, setFooterH]               = useState(0);
  const [openGroups, setOpenGroups]         = useState({
    household: true, pantry: true, finance: false,
    emergency: false, integrations: false, danger: false,
  });
  const toggleGroup = (id) => setOpenGroups((p) => ({ ...p, [id]: !p[id] }));
  const [reduceMotion, setReduceMotion]     = useState(false);
  const [foodFilter, setFoodFilter]         = useState('');
  const [nonFoodFilter, setNonFoodFilter]   = useState('');
  const [regenerating, setRegenerating]     = useState(false);
  const [nameInput, setNameInput]           = useState('');
  const [saving, setSaving]                 = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [nameError, setNameError]           = useState(null);
  const [enabledCategories, setEnabledCategories]                   = useState(null);
  const [customCategories, setCustomCategories]                     = useState([]);
  const [foodCategoryOrder, setFoodCategoryOrder]                   = useState([]);
  const [enabledNonFoodCategories, setEnabledNonFoodCategories]     = useState(null);
  const [customNonFoodCategories, setCustomNonFoodCategories]       = useState([]);
  const [nonFoodCategoryOrder, setNonFoodCategoryOrder]             = useState([]);
  const [catModal, setCatModal]                                     = useState(false);
  const [catModalType, setCatModalType]                             = useState('food');
  const [catForm, setCatForm]                                       = useState(BLANK_CAT);
  const [catError, setCatError]                                     = useState(null);
  const [customBillCats, setCustomBillCats]       = useState([]);
  const [customExpenseCats, setCustomExpenseCats] = useState([]);
  const [financeCatType, setFinanceCatType]       = useState(null); // 'bill' | 'expense' | null
  const [financeCatForm, setFinanceCatForm]       = useState({ label: '', icon: '💡' });
  const [financeCatError, setFinanceCatError]     = useState(null);
  const [contacts, setContacts]                   = useState([]);
  const scrollRef = useRef(null);
  const baselineRef   = useRef(null); // JSON of staged values at load / last save
  const isDirtyRef    = useRef(false);
  const allowLeaveRef = useRef(false); // bypass the unsaved-changes guard on intentional exit
  const persistRef    = useRef(null);  // latest persistChanges, for the guard listener
  const [contactModal, setContactModal]           = useState(null); // null | { mode: 'add'|'edit', contact }
  const [contactForm, setContactForm]             = useState(BLANK_CONTACT);
  const [contactSaving, setContactSaving]         = useState(false);
  const [goveeApiKey, setGoveeApiKey]             = useState('');
  const [showGoveeKey, setShowGoveeKey]           = useState(false);
  const [goveeEnabled, setGoveeEnabled]           = useState(false);
  const [xiaomiEnabled, setXiaomiEnabled]         = useState(false);
  const [reduceMotionPref, setReduceMotionPref]   = useState(false);
  const [openRouterApiKey, setOpenRouterApiKey]   = useState('');
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);
  const [xiaomiCreds, setXiaomiCreds]             = useState(BLANK_XIAOMI);
  const [showXiaomiSecrets, setShowXiaomiSecrets] = useState(false);
  const [aiModel, setAiModel]                     = useState(DEFAULT_AI_MODEL);
  const [enabledUnits, setEnabledUnits]           = useState(UNITS);
  const [customUnits, setCustomUnits]             = useState([]);
  const [newUnitInput, setNewUnitInput]           = useState('');
  const [unitError, setUnitError]                 = useState(null);

  useEffect(() => {
    const unsub = subscribeEmergencyContacts(hhId, (data) => {
      setContacts(data.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)));
    });
    return unsub;
  }, [hhId]);

  const openAddContact = () => {
    setContactForm(BLANK_CONTACT);
    setContactModal({ mode: 'add' });
  };

  const openEditContact = (c) => {
    setContactForm({ icon: c.icon, name: c.name, phone: c.phone, relationship: c.relationship, notes: c.notes ?? '' });
    setContactModal({ mode: 'edit', contactId: c.id });
  };

  const handleSaveContact = async () => {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) return;
    setContactSaving(true);
    try {
      if (contactModal.mode === 'add') {
        await addEmergencyContact(hhId, contactForm);
      } else {
        await updateEmergencyContact(hhId, contactModal.contactId, contactForm);
      }
      setContactModal(null);
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setContactSaving(false);
    }
  };

  const handleDeleteContact = async (contactId) => {
    const confirmed = await showConfirm({
      title: 'Delete contact',
      message: 'Remove this emergency contact?',
      confirmLabel: 'Delete',
      type: 'danger',
    });
    if (!confirmed) return;
    await deleteEmergencyContact(hhId, contactId).catch((e) =>
      showAlert({ title: 'Error', message: e.message, type: 'error' })
    );
  };

  const loadHousehold = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getHouseholdWithPrivate(hhId)
      .then((hh) => {
        setHousehold(hh);
        setNameInput(hh?.name ?? '');
        setEnabledCategories(
          hh?.pantryCategories ?? PANTRY_CATEGORIES.map((c) => c.label)
        );
        setCustomCategories(hh?.pantryCustomCategories ?? []);
        setFoodCategoryOrder(hh?.pantryCategoryOrder ?? []);
        setEnabledNonFoodCategories(
          hh?.nonFoodCategories ?? NON_FOOD_CATEGORIES.map((c) => c.label)
        );
        setCustomNonFoodCategories(hh?.nonFoodCustomCategories ?? []);
        setNonFoodCategoryOrder(hh?.nonFoodCategoryOrder ?? []);
        setCustomBillCats(hh?.billCustomCategories ?? []);
        setCustomExpenseCats(hh?.expenseCustomCategories ?? []);
        setGoveeApiKey(hh?.goveeApiKey ?? '');
        setOpenRouterApiKey(hh?.openRouterApiKey ?? '');
        const xc = hh?.xiaomiCreds ?? {};
        setXiaomiCreds({ ...BLANK_XIAOMI, ...xc });
        // Absent flag ⇒ enabled if already configured (see HouseholdContext).
        setGoveeEnabled(hh?.goveeEnabled ?? !!hh?.goveeApiKey);
        setXiaomiEnabled(hh?.xiaomiEnabled ?? !!(xc.userId || xc.serviceToken || xc.ssecurity));
        setReduceMotionPref(hh?.reduceMotion ?? false);
        setAiModel(hh?.aiModel ?? DEFAULT_AI_MODEL);
        setEnabledUnits(hh?.enabledUnits ?? UNITS);
        setCustomUnits(hh?.customUnits ?? []);

        // Ensure my own name/email is stored so I show as a real name, not a UID.
        const p = { name: (user?.displayName || '').trim(), email: (user?.email || '').trim() };
        const cur = hh?.memberProfiles?.[user?.uid];
        if (user?.uid && (!cur || cur.name !== p.name || cur.email !== p.email)) {
          upsertMemberProfile(hhId, user.uid, p).catch(() => {});
          setHousehold((prev) => (prev
            ? { ...prev, memberProfiles: { ...(prev.memberProfiles || {}), [user.uid]: p } }
            : prev));
        }
      })
      .catch((e) => setLoadError(e))
      .finally(() => setLoading(false));
  }, [hhId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadHousehold(); }, [loadHousehold]);

  // Honor the OS "reduce motion" setting for modal transitions.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub?.remove?.(); };
  }, []);

  // Warn before leaving with unsaved (staged) changes on back / swipe-back.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current || !isDirtyRef.current) return;
      e.preventDefault();
      const leave = () => { allowLeaveRef.current = true; navigation.dispatch(e.data.action); };
      showOptions({
        title: 'Unsaved changes',
        message: 'You have unsaved changes to this household.',
        type: 'warning',
        options: [
          { label: 'Save changes', value: 'save' },
          { label: 'Discard', value: 'discard', style: 'destructive' },
          { label: 'Cancel', style: 'cancel' },
        ],
      }).then(async (choice) => {
        if (choice === 'discard') {
          leave();
        } else if (choice === 'save') {
          const ok = await persistRef.current?.();
          if (ok) leave();
        }
        // cancel / null → stay on the screen
      });
    });
    return sub;
  }, [navigation, showOptions]);

  const togglePantryCategory = (label) => {
    setEnabledCategories((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const toggleNonFoodCategory = (label) => {
    setEnabledNonFoodCategories((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const openAddCategory = (type = 'food') => {
    setCatModalType(type);
    setCatForm(BLANK_CAT);
    setCatError(null);
    setCatModal(true);
  };

  const handleAddCategory = () => {
    const label = catForm.label.trim();
    if (!label) { setCatError('Name is required'); return; }
    const isFood = catModalType === 'food';
    const builtIn = isFood ? PANTRY_CATEGORIES : NON_FOOD_CATEGORIES;
    const custom  = isFood ? customCategories : customNonFoodCategories;
    const allLabels = [...builtIn.map((c) => c.label), ...custom.map((c) => c.label)];
    if (allLabels.some((l) => l.toLowerCase() === label.toLowerCase())) {
      setCatError('A category with this name already exists');
      return;
    }
    const newCat = { label, icon: catForm.icon };
    if (isFood) {
      setCustomCategories((prev) => [...prev, newCat]);
      setEnabledCategories((prev) => [...prev, label]);
    } else {
      setCustomNonFoodCategories((prev) => [...prev, newCat]);
      setEnabledNonFoodCategories((prev) => [...prev, label]);
    }
    setCatModal(false);
  };

  const handleDeleteCustomCategory = (label) => {
    setCustomCategories((prev) => prev.filter((c) => c.label !== label));
    setEnabledCategories((prev) => prev.filter((l) => l !== label));
    setFoodCategoryOrder((prev) => prev.filter((l) => l !== label));
  };

  const handleDeleteCustomNonFoodCategory = (label) => {
    setCustomNonFoodCategories((prev) => prev.filter((c) => c.label !== label));
    setEnabledNonFoodCategories((prev) => prev.filter((l) => l !== label));
    setNonFoodCategoryOrder((prev) => prev.filter((l) => l !== label));
  };

  const orderedFoodCats = useMemo(
    () => applyOrder([...PANTRY_CATEGORIES, ...customCategories], foodCategoryOrder),
    [customCategories, foodCategoryOrder],
  );

  const orderedNonFoodCats = useMemo(
    () => applyOrder([...NON_FOOD_CATEGORIES, ...customNonFoodCategories], nonFoodCategoryOrder),
    [customNonFoodCategories, nonFoodCategoryOrder],
  );

  // Snapshot of every batch-saved (staged) field. Emergency contacts are excluded —
  // they persist immediately through their own modal, not this snapshot.
  const snapshot = useMemo(() => ({
    name: nameInput.trim(),
    enabledCategories,
    customCategories,
    foodCategoryOrder: orderedFoodCats.map((c) => c.label),
    enabledNonFoodCategories,
    customNonFoodCategories,
    nonFoodCategoryOrder: orderedNonFoodCats.map((c) => c.label),
    customBillCats,
    customExpenseCats,
    goveeApiKey,
    openRouterApiKey,
    aiModel,
    enabledUnits,
    customUnits,
    xiaomiCreds,
    goveeEnabled,
    xiaomiEnabled,
    reduceMotion: reduceMotionPref,
  }), [
    nameInput, enabledCategories, customCategories, orderedFoodCats,
    enabledNonFoodCategories, customNonFoodCategories, orderedNonFoodCats,
    customBillCats, customExpenseCats, goveeApiKey, openRouterApiKey,
    aiModel, enabledUnits, customUnits, xiaomiCreds, goveeEnabled, xiaomiEnabled,
    reduceMotionPref,
  ]);

  // Capture the baseline once the household has loaded.
  useEffect(() => {
    if (!loading && household && baselineRef.current === null) {
      baselineRef.current = JSON.stringify(snapshot);
    }
  }, [loading, household, snapshot]);

  const isDirty = baselineRef.current !== null && JSON.stringify(snapshot) !== baselineRef.current;
  isDirtyRef.current = isDirty;

  const reorderFoodCategories = useCallback((from, to) => {
    const labels = orderedFoodCats.map((c) => c.label);
    const [removed] = labels.splice(from, 1);
    labels.splice(to, 0, removed);
    setFoodCategoryOrder(labels);
  }, [orderedFoodCats]);

  const reorderNonFoodCategories = useCallback((from, to) => {
    const labels = orderedNonFoodCats.map((c) => c.label);
    const [removed] = labels.splice(from, 1);
    labels.splice(to, 0, removed);
    setNonFoodCategoryOrder(labels);
  }, [orderedNonFoodCats]);

  // Row renderers shared by the draggable list (unfiltered) and the plain
  // filtered list (a search term is active, where reordering is disabled).
  const renderFoodCatRow = (cat) => {
    const isOn = enabledCategories?.includes(cat.label);
    const isCustom = !PANTRY_CATEGORIES.some((c) => c.label === cat.label);
    return (
      <>
        <TouchableOpacity
          style={styles.categoryRowToggle}
          onPress={() => togglePantryCategory(cat.label)}
          accessibilityRole="switch"
          accessibilityState={{ checked: isOn }}
          accessibilityLabel={cat.label}
        >
          <Text style={styles.categoryRowIcon}>{cat.icon}</Text>
          <Text style={[styles.categoryRowLabel, !isOn && { opacity: 0.4 }]}>{cat.label}</Text>
          <Ionicons
            name={isOn ? 'checkmark-circle' : 'ellipse-outline'}
            size={21}
            color={isOn ? colors.accent : colors.textTertiary}
          />
        </TouchableOpacity>
        {isCustom && (
          <TouchableOpacity
            onPress={() => handleDeleteCustomCategory(cat.label)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${cat.label}`}
            style={styles.categoryDeleteBtn}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          </TouchableOpacity>
        )}
      </>
    );
  };

  const renderNonFoodCatRow = (cat) => {
    const isOn = enabledNonFoodCategories?.includes(cat.label);
    const isCustom = !NON_FOOD_CATEGORIES.some((c) => c.label === cat.label);
    return (
      <>
        <TouchableOpacity
          style={styles.categoryRowToggle}
          onPress={() => toggleNonFoodCategory(cat.label)}
          accessibilityRole="switch"
          accessibilityState={{ checked: isOn }}
          accessibilityLabel={cat.label}
        >
          <Text style={styles.categoryRowIcon}>{cat.icon}</Text>
          <Text style={[styles.categoryRowLabel, !isOn && { opacity: 0.4 }]}>{cat.label}</Text>
          <Ionicons
            name={isOn ? 'checkmark-circle' : 'ellipse-outline'}
            size={21}
            color={isOn ? colors.accent : colors.textTertiary}
          />
        </TouchableOpacity>
        {isCustom && (
          <TouchableOpacity
            onPress={() => handleDeleteCustomNonFoodCategory(cat.label)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${cat.label}`}
            style={styles.categoryDeleteBtn}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          </TouchableOpacity>
        )}
      </>
    );
  };

  const matchesFilter = (cat, term) => cat.label.toLowerCase().includes(term.trim().toLowerCase());

  const openAddFinanceCat = (type) => {
    setFinanceCatType(type);
    setFinanceCatForm({ label: '', icon: '💡' });
    setFinanceCatError(null);
  };

  const handleAddFinanceCat = () => {
    const label = financeCatForm.label.trim();
    if (!label) { setFinanceCatError('Name is required'); return; }
    const existing = financeCatType === 'bill' ? customBillCats : customExpenseCats;
    if (existing.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      setFinanceCatError('A category with this name already exists');
      return;
    }
    const newCat = { key: `custom_${Date.now()}`, label, icon: financeCatForm.icon };
    if (financeCatType === 'bill')    setCustomBillCats((prev) => [...prev, newCat]);
    else                              setCustomExpenseCats((prev) => [...prev, newCat]);
    setFinanceCatType(null);
  };

  const handleDeleteFinanceCat = (type, key) => {
    if (type === 'bill')    setCustomBillCats((prev) => prev.filter((c) => c.key !== key));
    else                    setCustomExpenseCats((prev) => prev.filter((c) => c.key !== key));
  };

  const toggleUnit = (unit) => {
    setEnabledUnits((prev) =>
      prev.includes(unit) ? prev.filter((u) => u !== unit) : [...prev, unit]
    );
  };

  const handleAddUnit = () => {
    const value = newUnitInput.trim();
    if (!value) return;
    if ([...UNITS, ...customUnits].some((u) => u.toLowerCase() === value.toLowerCase())) {
      setUnitError('Unit already exists');
      return;
    }
    setCustomUnits((prev) => [...prev, value]);
    setNewUnitInput('');
  };

  // Persist staged changes without navigating. Returns true on success (incl. no-op),
  // false if validation or a write failed. The caller owns navigation.
  const persistChanges = async () => {
    if (!nameInput.trim()) { setNameError('Required'); return false; }

    // Only write fields that actually changed — this is a shared household doc,
    // so blindly rewriting every field clobbers concurrent edits by other members.
    const snap = snapshot;
    const base = baselineRef.current ? JSON.parse(baselineRef.current) : {};
    const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

    const writes = [];
    if (changed(snap.name, base.name)) {
      writes.push(updateHouseholdName(hhId, snap.name));
    }
    if (changed(snap.enabledCategories, base.enabledCategories)
      || changed(snap.customCategories, base.customCategories)
      || changed(snap.foodCategoryOrder, base.foodCategoryOrder)) {
      writes.push(updateHouseholdPantryCategories(hhId, snap.enabledCategories, snap.customCategories, snap.foodCategoryOrder));
    }
    if (changed(snap.enabledNonFoodCategories, base.enabledNonFoodCategories)
      || changed(snap.customNonFoodCategories, base.customNonFoodCategories)
      || changed(snap.nonFoodCategoryOrder, base.nonFoodCategoryOrder)) {
      writes.push(updateHouseholdNonFoodCategories(hhId, snap.enabledNonFoodCategories, snap.customNonFoodCategories, snap.nonFoodCategoryOrder));
    }
    if (changed(snap.customBillCats, base.customBillCats) || changed(snap.customExpenseCats, base.customExpenseCats)) {
      writes.push(updateHouseholdFinanceCategories(hhId, snap.customBillCats, snap.customExpenseCats));
    }
    if (changed(snap.goveeApiKey, base.goveeApiKey)) {
      writes.push(updateHouseholdGoveeApiKey(hhId, snap.goveeApiKey));
    }
    if (changed(snap.openRouterApiKey, base.openRouterApiKey)) {
      writes.push(updateHouseholdOpenRouterApiKey(hhId, snap.openRouterApiKey));
    }
    if (changed(snap.aiModel, base.aiModel)) {
      writes.push(updateHouseholdAiModel(hhId, snap.aiModel));
    }
    if (changed(snap.enabledUnits, base.enabledUnits) || changed(snap.customUnits, base.customUnits)) {
      writes.push(updateHouseholdUnits(hhId, snap.enabledUnits, snap.customUnits));
    }
    if (changed(snap.xiaomiCreds, base.xiaomiCreds)) {
      writes.push(updateHouseholdXiaomiCreds(hhId, snap.xiaomiCreds));
      writes.push(saveXiaomiCredentials(snap.xiaomiCreds)); // sync to this device's cache
    }
    if (changed(snap.goveeEnabled, base.goveeEnabled) || changed(snap.xiaomiEnabled, base.xiaomiEnabled)) {
      writes.push(updateHouseholdIntegrationFlags(hhId, {
        goveeEnabled: snap.goveeEnabled, xiaomiEnabled: snap.xiaomiEnabled,
      }));
    }
    if (changed(snap.reduceMotion, base.reduceMotion)) {
      writes.push(updateHouseholdReduceMotion(hhId, snap.reduceMotion));
    }

    if (writes.length === 0) return true;

    setSaving(true);
    try {
      await Promise.all(writes);
      baselineRef.current = JSON.stringify(snap);
      isDirtyRef.current = false;
      setHousehold((h) => ({ ...h, name: snap.name }));
      notify('Saved', 'Household updated.', { type: 'success' });
      return true;
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };
  persistRef.current = persistChanges;

  const handleSaveAll = async () => {
    if (await persistChanges()) {
      allowLeaveRef.current = true;
      navigation.goBack();
    }
  };

  const handleCopyCode = async () => {
    if (!household?.inviteCode) return;
    await Clipboard.setStringAsync(household.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    const confirmed = await showConfirm({
      title: 'Regenerate invite code',
      message: 'The current code will stop working immediately. Anyone using it will need the new code to join.',
      confirmLabel: 'Regenerate',
      type: 'danger',
    });
    if (!confirmed) return;
    setRegenerating(true);
    try {
      const code = await regenerateInviteCode(hhId);
      setHousehold((h) => (h ? { ...h, inviteCode: code } : h));
      notify('Invite code updated', 'A new code is now active.', { type: 'success' });
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setRegenerating(false);
    }
  };

  const handleTransferOwnership = async (uid, label) => {
    const confirmed = await showConfirm({
      title: 'Make owner',
      message: `Make ${label} the owner of "${household?.name}"? You'll stay a member but lose owner controls.`,
      confirmLabel: 'Make owner',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      await transferHouseholdOwnership(hhId, uid);
      setHousehold((h) => (h ? { ...h, createdBy: uid } : h));
      notify('Ownership transferred', `${label} is now the owner.`, { type: 'success' });
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const handleLeave = async () => {
    const confirmed = await showConfirm({
      title: 'Leave household',
      message: `Leave "${household?.name}"? You can rejoin with the invite code.`,
      confirmLabel: 'Leave',
      type: 'danger',
    });
    if (!confirmed) return;
    try {
      await leaveHousehold(hhId, user.uid);
      await removeHousehold(hhId);
      notify('Left household', `You've left "${household?.name}".`, { type: 'info' });
      allowLeaveRef.current = true;
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const handleRemoveMember = async (uid, label) => {
    const confirmed = await showConfirm({
      title: 'Remove member',
      message: `Remove ${label} from "${household?.name}"? They can rejoin with the invite code.`,
      confirmLabel: 'Remove',
      type: 'danger',
    });
    if (!confirmed) return;
    try {
      await removeHouseholdMember(hhId, uid);
      setHousehold((h) => {
        if (!h) return h;
        const profiles = { ...(h.memberProfiles || {}) };
        delete profiles[uid];
        return { ...h, members: (h.members || []).filter((m) => m !== uid), memberProfiles: profiles };
      });
      notify('Member removed', `${label} has been removed.`, { type: 'info' });
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const isCreator = household?.createdBy === user?.uid;
  const modalAnim = reduceMotion ? 'fade' : 'slide';

  const foodTerm    = foodFilter.trim();
  const nonFoodTerm = nonFoodFilter.trim();
  const filteredFoodCats    = foodTerm    ? orderedFoodCats.filter((c) => matchesFilter(c, foodFilter))       : null;
  const filteredNonFoodCats = nonFoodTerm ? orderedNonFoodCats.filter((c) => matchesFilter(c, nonFoodFilter)) : null;

  return (
    <View style={{ height: windowHeight, backgroundColor: colors.background, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }}>

      {/* Nav bar */}
      <View
        style={[styles.navBar, { paddingTop: insets.top + spacing.sm }]}
        onLayout={(e) => setNavBarH(e.nativeEvent.layout.height)}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Edit Household</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      ) : loadError ? (
        <View style={styles.errorState}>
          <Ionicons name="cloud-offline-outline" size={44} color={colors.textTertiary} />
          <Text style={styles.errorStateTitle}>Couldn't load household</Text>
          <Text style={styles.errorStateMsg}>
            {loadError?.message || 'Something went wrong. Check your connection and try again.'}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={loadHousehold}
            accessibilityRole="button"
            accessibilityLabel="Retry loading household"
          >
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryButtonLabel}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          // Web: the ancestor flex chain doesn't reliably bound a flex:1 ScrollView,
          // so pin it to the viewport minus the fixed nav bar and sticky save bar (web-scroll rule).
          style={Platform.OS === 'web' ? { height: Math.max(windowHeight - navBarH - footerH, 0) } : { flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
          ]}
          showsVerticalScrollIndicator={false}
        >

          {/* ═══ Household ═══ */}
          <Rise index={0}>
          <CollapsibleGroup
            title="Household" icon="home-outline"
            open={openGroups.household} onToggle={() => toggleGroup('household')}
            styles={styles} colors={colors}
          >

          {/* ── Name ── */}
          <Text style={styles.sectionLabel}>Household Name</Text>
          <View style={styles.card}>
            <TextInput
              style={[styles.textInput, !!nameError && styles.inputError]}
              value={nameInput}
              onChangeText={(t) => { setNameInput(t); if (nameError) setNameError(null); }}
              placeholderTextColor={colors.textTertiary}
              placeholder="Household name *"
              returnKeyType="done"
              accessibilityLabel="Household name"
            />
            {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}
          </View>

          {/* ── Invite code ── */}
          <Text style={styles.sectionLabel}>Invite Code</Text>
          <View style={styles.card}>
            <View style={styles.inviteRow}>
              <Text style={styles.inviteCode}>{household?.inviteCode ?? '—'}</Text>
              <TouchableOpacity
                style={[styles.copyButton, copied && { backgroundColor: colors.successSoft, borderColor: colors.success }]}
                onPress={handleCopyCode}
                accessibilityRole="button"
                accessibilityLabel="Copy invite code"
              >
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={15}
                  color={copied ? colors.success : colors.accent}
                />
                <Text style={[styles.copyButtonLabel, copied && { color: colors.success }]}>
                  {copied ? 'Copied!' : 'Copy'}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.inviteHint}>Share this code so others can join your household.</Text>
            {isCreator && (
              <TouchableOpacity
                style={styles.regenerateBtn}
                onPress={handleRegenerateCode}
                disabled={regenerating}
                accessibilityRole="button"
                accessibilityLabel="Regenerate invite code"
                accessibilityState={{ disabled: regenerating }}
              >
                <Ionicons name="refresh" size={14} color={regenerating ? colors.textTertiary : colors.danger} />
                <Text style={[styles.regenerateBtnLabel, regenerating && { color: colors.textTertiary }]}>
                  {regenerating ? 'Regenerating…' : 'Regenerate code'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Members ── */}
          <Text style={styles.sectionLabel}>Members</Text>
          <View style={styles.card}>
            {household?.members?.map((uid, i) => {
              const isYou = uid === user?.uid;
              const isOwner = uid === household?.createdBy;
              const profile = household?.memberProfiles?.[uid];
              const name = profile?.name?.trim();
              const displayLabel = name || profile?.email || (isYou ? 'You' : 'Member');
              return (
                <View key={uid} style={[styles.memberRow, i > 0 && styles.memberRowBorder]}>
                  <View style={styles.memberAvatar}>
                    <Ionicons name="person" size={14} color={colors.textTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName} numberOfLines={1}>{displayLabel}</Text>
                    {!!name && !!profile?.email && (
                      <Text style={styles.memberEmail} numberOfLines={1}>{profile.email}</Text>
                    )}
                  </View>
                  <View style={styles.memberBadges}>
                    {isOwner && (
                      <View style={styles.ownerBadge}>
                        <Text style={styles.ownerBadgeText}>Owner</Text>
                      </View>
                    )}
                    {isYou && !isOwner && (
                      <View style={styles.youBadge}>
                        <Text style={styles.youBadgeText}>You</Text>
                      </View>
                    )}
                    {isCreator && !isYou && !isOwner && (
                      <>
                        <TouchableOpacity
                          style={styles.memberActionBtn}
                          onPress={() => handleTransferOwnership(uid, displayLabel)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Make ${displayLabel} owner`}
                        >
                          <Ionicons name="ribbon-outline" size={18} color={colors.accent} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.memberRemoveBtn}
                          onPress={() => handleRemoveMember(uid, displayLabel)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${displayLabel}`}
                        >
                          <Ionicons name="close-circle" size={20} color={colors.danger} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* ── Appearance ── */}
          <Text style={styles.sectionLabel}>Appearance</Text>
          <View style={styles.card}>
            <View style={styles.integrationToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrationToggleTitle}>Reduce motion</Text>
                <Text style={styles.inviteHint}>
                  Turns off entrance, chart and list animations across the app. Applies to everyone in the household.
                </Text>
              </View>
              <Switch
                value={reduceMotionPref}
                onValueChange={setReduceMotionPref}
                trackColor={{ false: colors.muted, true: colors.accent }}
                thumbColor="#fff"
                ios_backgroundColor={colors.muted}
                accessibilityLabel="Reduce motion"
              />
            </View>
          </View>

          </CollapsibleGroup>
          </Rise>

          {/* ═══ Pantry & Groceries ═══ */}
          <Rise index={1}>
          <CollapsibleGroup
            title="Pantry & Groceries" icon="basket-outline"
            open={openGroups.pantry} onToggle={() => toggleGroup('pantry')}
            styles={styles} colors={colors}
          >

          {/* ── Pantry Categories ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Food Categories</Text>
            <TouchableOpacity
              style={styles.addContactBtn}
              onPress={() => openAddCategory('food')}
              accessibilityRole="button"
              accessibilityLabel="Add food category"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={styles.addContactBtnLabel}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.card, { padding: 0 }]}>
            {enabledCategories !== null && (
              <>
                <View style={styles.catSearchRow}>
                  <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
                  <TextInput
                    style={styles.catSearchInput}
                    value={foodFilter}
                    onChangeText={setFoodFilter}
                    placeholder="Filter food categories…"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    accessibilityLabel="Filter food categories"
                  />
                  {!!foodTerm && (
                    <TouchableOpacity
                      onPress={() => setFoodFilter('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button" accessibilityLabel="Clear filter"
                    >
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
                {foodTerm ? (
                  filteredFoodCats.length === 0 ? (
                    <Text style={[styles.inviteHint, { padding: spacing.lg, textAlign: 'center' }]}>
                      No categories match “{foodTerm}”.
                    </Text>
                  ) : filteredFoodCats.map((cat, i) => (
                    <View key={cat.label} style={[styles.categoryRow, i > 0 && styles.categoryRowBorder]}>
                      {renderFoodCatRow(cat)}
                    </View>
                  ))
                ) : (
                  <DraggableCategoryList
                    items={orderedFoodCats}
                    onReorder={reorderFoodCategories}
                    scrollRef={scrollRef}
                    renderItem={renderFoodCatRow}
                  />
                )}
              </>
            )}
          </View>

          {/* ── Non-Food Categories ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Non-Food Categories</Text>
            <TouchableOpacity
              style={styles.addContactBtn}
              onPress={() => openAddCategory('non-food')}
              accessibilityRole="button"
              accessibilityLabel="Add non-food category"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={styles.addContactBtnLabel}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.card, { padding: 0 }]}>
            {enabledNonFoodCategories !== null && (
              <>
                <View style={styles.catSearchRow}>
                  <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
                  <TextInput
                    style={styles.catSearchInput}
                    value={nonFoodFilter}
                    onChangeText={setNonFoodFilter}
                    placeholder="Filter non-food categories…"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    accessibilityLabel="Filter non-food categories"
                  />
                  {!!nonFoodTerm && (
                    <TouchableOpacity
                      onPress={() => setNonFoodFilter('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button" accessibilityLabel="Clear filter"
                    >
                      <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>
                {nonFoodTerm ? (
                  filteredNonFoodCats.length === 0 ? (
                    <Text style={[styles.inviteHint, { padding: spacing.lg, textAlign: 'center' }]}>
                      No categories match “{nonFoodTerm}”.
                    </Text>
                  ) : filteredNonFoodCats.map((cat, i) => (
                    <View key={cat.label} style={[styles.categoryRow, i > 0 && styles.categoryRowBorder]}>
                      {renderNonFoodCatRow(cat)}
                    </View>
                  ))
                ) : (
                  <DraggableCategoryList
                    items={orderedNonFoodCats}
                    onReorder={reorderNonFoodCategories}
                    scrollRef={scrollRef}
                    renderItem={renderNonFoodCatRow}
                  />
                )}
              </>
            )}
          </View>

          {/* ── Units ── */}
          <Text style={styles.sectionLabel}>Food Units</Text>
          <View style={styles.card}>
            <Text style={styles.inviteHint}>Select which units appear in pantry and grocery pickers.</Text>
            <View style={styles.unitsGrid}>
              {UNITS.map((unit) => {
                const isOn = enabledUnits.includes(unit);
                return (
                  <TouchableOpacity
                    key={unit}
                    style={[styles.unitToggle, isOn && styles.unitToggleActive]}
                    onPress={() => toggleUnit(unit)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isOn }}
                    accessibilityLabel={unit}
                  >
                    <Text style={[styles.unitToggleLabel, isOn && styles.unitToggleLabelActive]}>{unit}</Text>
                  </TouchableOpacity>
                );
              })}
              {customUnits.map((unit) => (
                <View key={unit} style={[styles.unitToggle, styles.unitToggleActive, { flexDirection: 'row', gap: 5 }]}>
                  <Text style={styles.unitToggleLabelActive}>{unit}</Text>
                  <TouchableOpacity
                    onPress={() => setCustomUnits((prev) => prev.filter((u) => u !== unit))}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${unit}`}
                  >
                    <Ionicons name="close" size={12} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
            <View style={styles.addUnitRow}>
              <TextInput
                style={[styles.addUnitInput, !!unitError && styles.inputError]}
                value={newUnitInput}
                onChangeText={(t) => { setNewUnitInput(t); if (unitError) setUnitError(null); }}
                placeholder="Add custom unit…"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                onSubmitEditing={handleAddUnit}
                autoCapitalize="none"
                accessibilityLabel="Custom unit name"
              />
              <TouchableOpacity
                style={[styles.addUnitBtn, !newUnitInput.trim() && { opacity: 0.4 }]}
                onPress={handleAddUnit}
                disabled={!newUnitInput.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add unit"
              >
                <Ionicons name="add" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
            {!!unitError && <Text style={styles.errorText}>{unitError}</Text>}
          </View>

          </CollapsibleGroup>
          </Rise>

          {/* ═══ Finance ═══ */}
          <Rise index={2}>
          <CollapsibleGroup
            title="Finance" icon="wallet-outline"
            open={openGroups.finance} onToggle={() => toggleGroup('finance')}
            styles={styles} colors={colors}
          >

          {/* ── Bill Categories ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Bill Categories</Text>
            <TouchableOpacity
              style={styles.addContactBtn}
              onPress={() => openAddFinanceCat('bill')}
              accessibilityRole="button"
              accessibilityLabel="Add bill category"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={styles.addContactBtnLabel}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.card, { padding: 0 }]}>
            {customBillCats.length === 0 ? (
              <Text style={[styles.inviteHint, { padding: spacing.lg, textAlign: 'center' }]}>
                No custom bill categories yet.
              </Text>
            ) : customBillCats.map((cat, i) => (
              <View key={cat.key} style={[styles.categoryRow, i > 0 && styles.categoryRowBorder]}>
                <View style={styles.categoryRowToggle}>
                  <Text style={styles.categoryRowIcon}>{cat.icon}</Text>
                  <Text style={styles.categoryRowLabel}>{cat.label}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteFinanceCat('bill', cat.key)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.categoryDeleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${cat.label}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* ── Expense Categories ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Expense Categories</Text>
            <TouchableOpacity
              style={styles.addContactBtn}
              onPress={() => openAddFinanceCat('expense')}
              accessibilityRole="button"
              accessibilityLabel="Add expense category"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={styles.addContactBtnLabel}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.card, { padding: 0 }]}>
            {customExpenseCats.length === 0 ? (
              <Text style={[styles.inviteHint, { padding: spacing.lg, textAlign: 'center' }]}>
                No custom expense categories yet.
              </Text>
            ) : customExpenseCats.map((cat, i) => (
              <View key={cat.key} style={[styles.categoryRow, i > 0 && styles.categoryRowBorder]}>
                <View style={styles.categoryRowToggle}>
                  <Text style={styles.categoryRowIcon}>{cat.icon}</Text>
                  <Text style={styles.categoryRowLabel}>{cat.label}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteFinanceCat('expense', cat.key)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.categoryDeleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${cat.label}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          </CollapsibleGroup>
          </Rise>

          {/* ═══ Emergency ═══ */}
          <Rise index={3}>
          <CollapsibleGroup
            title="Emergency Contacts" icon="medkit-outline"
            open={openGroups.emergency} onToggle={() => toggleGroup('emergency')}
            styles={styles} colors={colors}
            action={(
              <TouchableOpacity
                style={styles.addContactBtn}
                onPress={openAddContact}
                accessibilityRole="button"
                accessibilityLabel="Add emergency contact"
              >
                <Ionicons name="add" size={15} color={colors.accent} />
                <Text style={styles.addContactBtnLabel}>Add</Text>
              </TouchableOpacity>
            )}
          >
          <View style={[styles.card, contacts.length === 0 && { paddingVertical: spacing.lg }]}>
            {contacts.length === 0 ? (
              <Text style={[styles.inviteHint, { textAlign: 'center' }]}>No emergency contacts yet.</Text>
            ) : (
              contacts.map((c, i) => (
                <View key={c.id} style={[styles.contactRow, i > 0 && styles.contactRowBorder]}>
                  <View style={styles.contactIconWrap}>
                    <Text style={styles.contactIcon}>{c.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    {!!c.relationship && <Text style={styles.contactRelationship}>{c.relationship}</Text>}
                    {!!c.phone && <Text style={styles.contactPhone}>{c.phone}</Text>}
                    {!!c.notes && <Text style={styles.contactNotes}>{c.notes}</Text>}
                  </View>
                  <View style={styles.contactActions}>
                    <TouchableOpacity
                      onPress={() => openEditContact(c)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${c.name}`}
                    >
                      <Ionicons name="pencil-outline" size={17} color={colors.textTertiary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteContact(c.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${c.name}`}
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          </CollapsibleGroup>
          </Rise>

          {/* ═══ Integrations ═══ */}
          <Rise index={4}>
          <CollapsibleGroup
            title="Integrations" icon="hardware-chip-outline"
            open={openGroups.integrations} onToggle={() => toggleGroup('integrations')}
            styles={styles} colors={colors}
          >

          {/* ── OpenRouter API Key ── */}
          <Text style={styles.sectionLabel}>OpenRouter API Key</Text>
          <View style={styles.card}>
            <View style={styles.goveeKeyRow}>
              <TextInput
                style={[styles.textInput, { flex: 1 }]}
                value={openRouterApiKey}
                onChangeText={setOpenRouterApiKey}
                placeholder="Paste your OpenRouter API key…"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showOpenRouterKey}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="OpenRouter API key"
              />
              <TouchableOpacity
                onPress={() => setShowOpenRouterKey((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={showOpenRouterKey ? 'Hide API key' : 'Show API key'}
                style={styles.goveeKeyToggle}
              >
                <Ionicons
                  name={showOpenRouterKey ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            </View>
            <Text style={styles.inviteHint}>
              Powers the AI assistant and bank-statement import. Create a key at openrouter.ai under Keys. Stored securely per household.
            </Text>
          </View>

          {/* ── AI Model ── */}
          <Text style={styles.sectionLabel}>AI Model</Text>
          <View style={styles.card}>
            {AI_MODELS.map((m, i) => {
              const selected = aiModel === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.modelRow, i > 0 && styles.modelRowBorder]}
                  onPress={() => setAiModel(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.accent : colors.textTertiary}
                  />
                  <View style={{ flex: 1 }}>
                    <View style={styles.modelTitleRow}>
                      <Text style={styles.modelLabel}>{m.label}</Text>
                      <View style={[
                        styles.modelTag,
                        { backgroundColor: m.tier === 'free' ? colors.sageSoft : colors.muted },
                      ]}>
                        <Text style={[
                          styles.modelTagText,
                          { color: m.tier === 'free' ? colors.sage : colors.textSecondary },
                        ]}>
                          {m.tier === 'free' ? 'Free' : 'Paid'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.modelHint}>{m.hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <Text style={styles.inviteHint}>
              Free models (ID ending in :free) are smaller and rate-limited (~50 requests/day). PDF statement import runs through free OCR on free models — paid models read PDFs directly and more accurately.
            </Text>
          </View>

          {/* ── Govee Smart Lights ── */}
          <Text style={styles.sectionLabel}>Govee Smart Lights</Text>
          <View style={styles.card}>
            <View style={styles.integrationToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrationToggleTitle}>Enable Govee</Text>
                <Text style={styles.inviteHint}>Shows the Lights page and enables Govee light control.</Text>
              </View>
              <Switch
                value={goveeEnabled}
                onValueChange={setGoveeEnabled}
                trackColor={{ false: colors.muted, true: colors.accent }}
                thumbColor="#fff"
                ios_backgroundColor={colors.muted}
                accessibilityLabel="Enable Govee integration"
              />
            </View>
            {goveeEnabled && (
              <>
                <View style={styles.goveeKeyRow}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={goveeApiKey}
                    onChangeText={setGoveeApiKey}
                    placeholder="Paste your Govee API key…"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry={!showGoveeKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Govee API key"
                  />
                  <TouchableOpacity
                    onPress={() => setShowGoveeKey((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={showGoveeKey ? 'Hide API key' : 'Show API key'}
                    style={styles.goveeKeyToggle}
                  >
                    <Ionicons
                      name={showGoveeKey ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                </View>
                <Text style={styles.inviteHint}>
                  Found in the Govee Home app under Profile → About Us → Apply for API key. Stored securely per household.
                </Text>
              </>
            )}
          </View>

          {/* ── Xiaomi (Mi Home) ── */}
          <Text style={styles.sectionLabel}>Xiaomi (Mi Home)</Text>
          <View style={styles.card}>
            <View style={styles.integrationToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.integrationToggleTitle}>Enable Xiaomi</Text>
                <Text style={styles.inviteHint}>Shows the Xiaomi page and enables Mi Home device control.</Text>
              </View>
              <Switch
                value={xiaomiEnabled}
                onValueChange={setXiaomiEnabled}
                trackColor={{ false: colors.muted, true: colors.accent }}
                thumbColor="#fff"
                ios_backgroundColor={colors.muted}
                accessibilityLabel="Enable Xiaomi integration"
              />
            </View>
            {xiaomiEnabled && (
              <>
            <Text style={styles.modalLabel}>User ID</Text>
            <TextInput
              style={styles.textInput}
              value={xiaomiCreds.userId}
              onChangeText={(t) => setXiaomiCreds((c) => ({ ...c, userId: t }))}
              placeholder="1234567890"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Xiaomi user ID"
            />

            <View style={styles.xiaomiLabelRow}>
              <Text style={styles.modalLabel}>Service Token</Text>
              <TouchableOpacity
                onPress={() => setShowXiaomiSecrets((v) => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={showXiaomiSecrets ? 'Hide secrets' : 'Show secrets'}
              >
                <Ionicons
                  name={showXiaomiSecrets ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.textInput}
              value={xiaomiCreds.serviceToken}
              onChangeText={(t) => setXiaomiCreds((c) => ({ ...c, serviceToken: t }))}
              placeholder="Service token"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showXiaomiSecrets}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Xiaomi service token"
            />

            <Text style={styles.modalLabel}>Security Key (ssecurity)</Text>
            <TextInput
              style={styles.textInput}
              value={xiaomiCreds.ssecurity}
              onChangeText={(t) => setXiaomiCreds((c) => ({ ...c, ssecurity: t }))}
              placeholder="base64-encoded key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!showXiaomiSecrets}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Xiaomi security key"
            />

            <Text style={styles.modalLabel}>Region</Text>
            <View style={styles.unitsGrid}>
              {XIAOMI_REGIONS.map((r) => {
                const isOn = xiaomiCreds.region === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.unitToggle, isOn && styles.unitToggleActive]}
                    onPress={() => setXiaomiCreds((c) => ({ ...c, region: r.key }))}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isOn }}
                    accessibilityLabel={r.label}
                  >
                    <Text style={[styles.unitToggleLabel, isOn && styles.unitToggleLabelActive]}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.inviteHint}>
              Get User ID, Service Token, and ssecurity from the Mi Home app using a token extractor (e.g. xiaomi-cloud-tokens-extractor). Shared with your household and synced to each device.
            </Text>
              </>
            )}
          </View>

          </CollapsibleGroup>
          </Rise>

          {/* ═══ Danger Zone ═══ */}
          <Rise index={5}>
          <CollapsibleGroup
            title="Danger Zone" icon="warning-outline"
            open={openGroups.danger} onToggle={() => toggleGroup('danger')}
            styles={styles} colors={colors}
          >
          <View style={styles.card}>
            <TouchableOpacity style={styles.leaveButton} onPress={handleLeave} accessibilityRole="button">
              <Ionicons name="exit-outline" size={18} color={colors.danger} />
              <Text style={styles.leaveButtonLabel}>Leave Household</Text>
            </TouchableOpacity>
          </View>
          </CollapsibleGroup>
          </Rise>

        </ScrollView>
      )}

      {/* ── Sticky save bar (disabled until there are unsaved changes) ── */}
      {!loading && !loadError && (
        <View
          style={[styles.saveBar, { paddingBottom: insets.bottom + spacing.md }]}
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
        >
          <View style={isDesktop ? { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' } : null}>
            <TouchableOpacity
              style={[styles.updateButton, { marginTop: 0 }, (!isDirty || saving) && styles.updateButtonDisabled]}
              onPress={handleSaveAll}
              disabled={!isDirty || saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isDirty || saving }}
            >
              <Text style={styles.updateButtonLabel}>{saving ? 'Saving…' : isDirty ? 'Save Changes' : 'No Changes'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Finance Category Modal ── */}
      <Modal
        visible={financeCatType !== null}
        transparent
        animationType={modalAnim}
        onRequestClose={() => setFinanceCatType(null)}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {financeCatType === 'bill' ? 'Add Bill Category' : 'Add Expense Category'}
              </Text>
              <TouchableOpacity onPress={() => setFinanceCatType(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <IconPicker
              icons={FINANCE_ICONS}
              value={financeCatForm.icon}
              onChange={(ic) => setFinanceCatForm((f) => ({ ...f, icon: ic }))}
            />

            <Text style={styles.modalLabel}>Category Name *</Text>
            <TextInput
              style={[styles.modalInput, !!financeCatError && styles.inputError]}
              value={financeCatForm.label}
              onChangeText={(t) => { setFinanceCatForm((f) => ({ ...f, label: t })); if (financeCatError) setFinanceCatError(null); }}
              placeholder="e.g. Pet care, Garden"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleAddFinanceCat}
              autoFocus
              accessibilityLabel="Category name"
            />
            {!!financeCatError && <Text style={styles.errorText}>{financeCatError}</Text>}

            <TouchableOpacity
              style={[styles.updateButton, !financeCatForm.label.trim() && { opacity: 0.4 }]}
              onPress={handleAddFinanceCat}
              disabled={!financeCatForm.label.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.updateButtonLabel}>Add Category</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add Pantry Category Modal ── */}
      <Modal
        visible={catModal}
        transparent
        animationType={modalAnim}
        onRequestClose={() => setCatModal(false)}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{catModalType === 'non-food' ? 'Add Non-Food Category' : 'Add Food Category'}</Text>
              <TouchableOpacity onPress={() => setCatModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <IconPicker
              icons={CATEGORY_ICONS}
              value={catForm.icon}
              onChange={(ic) => setCatForm((f) => ({ ...f, icon: ic }))}
            />

            <Text style={styles.modalLabel}>Category Name *</Text>
            <TextInput
              style={[styles.modalInput, !!catError && styles.inputError]}
              value={catForm.label}
              onChangeText={(t) => { setCatForm((f) => ({ ...f, label: t })); if (catError) setCatError(null); }}
              placeholder="e.g. Dairy, Fresh Produce"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleAddCategory}
              autoFocus
              accessibilityLabel="Category name"
            />
            {!!catError && <Text style={styles.errorText}>{catError}</Text>}

            <TouchableOpacity
              style={[styles.updateButton, !catForm.label.trim() && { opacity: 0.4 }]}
              onPress={handleAddCategory}
              disabled={!catForm.label.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.updateButtonLabel}>Add Category</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Contact Modal ── */}
      <Modal
        visible={!!contactModal}
        transparent
        animationType={modalAnim}
        onRequestClose={() => setContactModal(null)}
      >
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {contactModal?.mode === 'add' ? 'Add Contact' : 'Edit Contact'}
              </Text>
              <TouchableOpacity onPress={() => setContactModal(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Icon picker */}
            <IconPicker
              icons={CONTACT_ICONS}
              value={contactForm.icon}
              onChange={(ic) => setContactForm((f) => ({ ...f, icon: ic }))}
            />

            {/* Name */}
            <Text style={styles.modalLabel}>Name *</Text>
            <TextInput
              style={styles.modalInput}
              value={contactForm.name}
              onChangeText={(t) => setContactForm((f) => ({ ...f, name: t }))}
              placeholder="e.g. Dr. Smith, Mom, Police"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
              accessibilityLabel="Contact name"
            />

            {/* Phone */}
            <Text style={styles.modalLabel}>Phone / Contact *</Text>
            <TextInput
              style={styles.modalInput}
              value={contactForm.phone}
              onChangeText={(t) => setContactForm((f) => ({ ...f, phone: t }))}
              placeholder="+1 555 000 0000"
              placeholderTextColor={colors.textTertiary}
              keyboardType="phone-pad"
              returnKeyType="next"
              accessibilityLabel="Phone number"
            />

            {/* Relationship */}
            <Text style={styles.modalLabel}>Relationship</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
              {RELATIONSHIPS.map((rel) => (
                <TouchableOpacity
                  key={rel}
                  style={[styles.chip, contactForm.relationship === rel && styles.chipSelected]}
                  onPress={() => setContactForm((f) => ({ ...f, relationship: rel === f.relationship ? '' : rel }))}
                  accessibilityRole="button"
                  accessibilityLabel={rel}
                >
                  <Text style={[styles.chipLabel, contactForm.relationship === rel && styles.chipLabelSelected]}>{rel}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Notes */}
            <Text style={styles.modalLabel}>Notes</Text>
            <TextInput
              style={[styles.modalInput, styles.modalInputMulti]}
              value={contactForm.notes}
              onChangeText={(t) => setContactForm((f) => ({ ...f, notes: t }))}
              placeholder="Address, hours, extra info…"
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
              returnKeyType="done"
              accessibilityLabel="Notes"
            />

            <TouchableOpacity
              style={[
                styles.updateButton,
                (contactSaving || !contactForm.name.trim() || !contactForm.phone.trim()) && { opacity: 0.4 },
              ]}
              onPress={handleSaveContact}
              disabled={contactSaving || !contactForm.name.trim() || !contactForm.phone.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.updateButtonLabel}>{contactSaving ? 'Saving…' : 'Save Contact'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md, // paddingTop set inline from safe-area insets
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navTitle: { ...type.h4, color: colors.textPrimary },

  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md },

  group: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  groupHeaderMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  groupHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  groupIconRing: {
    width: 32, height: 32, borderRadius: radius.full,
    backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  groupTitle: { ...type.bodyMed, color: colors.textPrimary, fontWeight: '700' },
  groupBody: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md,
  },

  saveBar: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  updateButtonDisabled: { backgroundColor: colors.muted, opacity: Platform.OS === 'web' ? 0.6 : 1 },

  errorState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xxl, gap: spacing.sm,
  },
  errorStateTitle: { ...type.h4, color: colors.textPrimary, marginTop: spacing.sm },
  errorStateMsg:   { ...type.body, color: colors.textTertiary, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.md,
  },
  retryButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  sectionLabel: {
    ...type.label, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.sm,
  },

  card: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    padding: spacing.lg, gap: spacing.md,
  },

  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  updateButton: {
    height: 52, backgroundColor: colors.accent, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm,
  },
  updateButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  integrationToggleRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  integrationToggleTitle: { ...type.body, color: colors.textPrimary, fontWeight: '600' },

  goveeKeyRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  goveeKeyToggle: { padding: spacing.sm },
  xiaomiLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  modelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  modelRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  modelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modelLabel: { ...type.body, color: colors.textPrimary, fontWeight: '600' },
  modelTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  modelTagText: { ...type.caption, fontWeight: '700', fontSize: 10 },
  modelHint: { ...type.caption, color: colors.textTertiary, marginTop: 2 },

  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inviteCode: {
    flex: 1, ...type.h3, color: colors.textPrimary,
    letterSpacing: 4, fontVariant: ['tabular-nums'],
  },
  copyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.accent,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  copyButtonLabel: { ...type.label, color: colors.accent, fontWeight: '700' },
  inviteHint: { ...type.caption, color: colors.textTertiary },
  regenerateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  regenerateBtnLabel: { ...type.label, color: colors.danger, fontWeight: '600' },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: 0 },
  memberAvatar: {
    width: 30, height: 30, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  memberName:   { ...type.bodySm, color: colors.textPrimary, fontWeight: '600' },
  memberEmail:  { ...type.caption, color: colors.textTertiary, marginTop: 1 },
  memberBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  memberRemoveBtn: { padding: 2 },
  memberActionBtn: { padding: 2 },
  ownerBadge: {
    backgroundColor: colors.amberSoft, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  ownerBadgeText: { ...type.caption, color: colors.amber, fontWeight: '700' },
  youBadge: {
    backgroundColor: colors.accentSoft, borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  youBadgeText: { ...type.caption, color: colors.accent, fontWeight: '700' },

  unitsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  unitToggle: {
    paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  unitToggleActive: {
    backgroundColor: colors.accentSoft, borderColor: colors.accent,
  },
  unitToggleLabel:       { ...type.label, color: colors.textSecondary },
  unitToggleLabelActive: { ...type.label, color: colors.accent },

  addUnitRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs,
  },
  addUnitInput: {
    flex: 1, height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  addUnitBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  categoryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  categoryRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  categoryRowToggle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: 13,
  },
  categoryRowIcon:   { fontSize: 18, width: 24, textAlign: 'center' },
  categoryRowLabel:  { ...type.bodyMed, color: colors.textPrimary, flex: 1 },
  categoryDeleteBtn: { paddingLeft: spacing.sm },
  catSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  catSearchInput: { flex: 1, ...type.body, color: colors.textPrimary, paddingVertical: 4 },

  leaveButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger,
    borderRadius: radius.md, padding: spacing.lg,
  },
  leaveButtonLabel: { ...type.bodyMed, color: colors.danger, fontWeight: '700' },

  inputError: { borderColor: colors.danger, borderWidth: 1.5 },
  errorText:  { ...type.caption, color: colors.danger, marginTop: 2 },

  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  addContactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  addContactBtnLabel: { ...type.label, color: colors.accent },

  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4,
  },
  contactRowBorder: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.sm },
  contactIconWrap: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  contactIcon:         { fontSize: 20 },
  contactName:         { ...type.bodyMed, color: colors.textPrimary },
  contactRelationship: { ...type.caption, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  contactPhone:        { ...type.bodySm, color: colors.accent, marginTop: 1 },
  contactNotes:        { ...type.caption, color: colors.textTertiary, marginTop: 1 },
  contactActions:      { flexDirection: 'row', gap: spacing.lg },

  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.xl, gap: spacing.md,
    paddingBottom: 48,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalTitle: { ...type.h4, color: colors.textPrimary },
  modalLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  modalInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },
  modalInputMulti: {
    height: 80, paddingTop: spacing.md, textAlignVertical: 'top',
  },

  chipRow:        { marginVertical: 4 },
  chipRowContent: { gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  chipSelected:      { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipLabel:         { ...type.label, color: colors.textSecondary },
  chipLabelSelected: { color: colors.accent },
});
