import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Platform, Modal, Switch,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import {
  getHouseholdWithPrivate, updateHouseholdName, leaveHousehold, updateHouseholdPantryCategories,
  updateHouseholdNonFoodCategories, updateHouseholdFinanceCategories, updateHouseholdGoveeApiKey,
  updateHouseholdOpenRouterApiKey, updateHouseholdAiModel,
  updateHouseholdUnits, upsertMemberProfile, updateHouseholdXiaomiCreds,
  subscribeEmergencyContacts, addEmergencyContact, updateEmergencyContact, deleteEmergencyContact,
} from '../../services/firestore';
import { saveCredentials as saveXiaomiCredentials } from '../../services/xiaomi';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS } from '../../utils/categories';
import { AI_MODELS, DEFAULT_AI_MODEL } from '../../utils/aiModels';
import DraggableCategoryList from '../../components/DraggableCategoryList';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, SIDEBAR_WIDTH, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { useWindowDimensions } from 'react-native';

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

export default function HouseholdEditScreen({ route, navigation }) {
  const { householdId: hhId } = route.params;
  const { user, removeHousehold } = useAuth();
  const { colors } = useTheme();
  const { showAlert, showConfirm } = useAlert();
  const { notify } = useNotification();

  const styles    = useMemo(() => makeStyles(colors), [colors]);
  const isDesktop = useIsDesktop();
  const { height: windowHeight } = useWindowDimensions();

  const [household, setHousehold]           = useState(null);
  const [loading, setLoading]               = useState(true);
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
  const [contactModal, setContactModal]           = useState(null); // null | { mode: 'add'|'edit', contact }
  const [contactForm, setContactForm]             = useState(BLANK_CONTACT);
  const [contactSaving, setContactSaving]         = useState(false);
  const [goveeApiKey, setGoveeApiKey]             = useState('');
  const [showGoveeKey, setShowGoveeKey]           = useState(false);
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

  useEffect(() => {
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
        setXiaomiCreds({ ...BLANK_XIAOMI, ...(hh?.xiaomiCreds ?? {}) });
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
      .finally(() => setLoading(false));
  }, [hhId]);

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

  const handleSaveAll = async () => {
    if (!nameInput.trim()) { setNameError('Required'); return; }
    setSaving(true);
    try {
      await Promise.all([
        updateHouseholdName(hhId, nameInput.trim()),
        updateHouseholdPantryCategories(hhId, enabledCategories, customCategories, orderedFoodCats.map((c) => c.label)),
        updateHouseholdNonFoodCategories(hhId, enabledNonFoodCategories, customNonFoodCategories, orderedNonFoodCats.map((c) => c.label)),
        updateHouseholdFinanceCategories(hhId, customBillCats, customExpenseCats),
        updateHouseholdGoveeApiKey(hhId, goveeApiKey),
        updateHouseholdOpenRouterApiKey(hhId, openRouterApiKey),
        updateHouseholdAiModel(hhId, aiModel),
        updateHouseholdUnits(hhId, enabledUnits, customUnits),
        updateHouseholdXiaomiCreds(hhId, xiaomiCreds),
        saveXiaomiCredentials(xiaomiCreds), // sync to this device's cache
      ]);
      setHousehold((h) => ({ ...h, name: nameInput.trim() }));
      notify('Saved', 'Household updated.', { type: 'success' });
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async () => {
    if (!household?.inviteCode) return;
    await Clipboard.setStringAsync(household.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      navigation.goBack();
    } catch (e) {
      showAlert({ title: 'Error', message: e.message, type: 'error' });
    }
  };

  const isCreator = household?.createdBy === user?.uid;
  const memberCount = household?.members?.length ?? 0;

  return (
    <View style={{ height: windowHeight, backgroundColor: colors.background, marginLeft: isDesktop ? SIDEBAR_WIDTH : 0 }}>

      {/* Nav bar */}
      <View style={styles.navBar}>
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
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollContent,
            isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },
          ]}
          showsVerticalScrollIndicator={false}
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
                  </View>
                </View>
              );
            })}
          </View>

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
              <DraggableCategoryList
                items={orderedFoodCats}
                onReorder={reorderFoodCategories}
                scrollRef={scrollRef}
                renderItem={(cat) => {
                  const isOn = enabledCategories.includes(cat.label);
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
                }}
              />
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
              <DraggableCategoryList
                items={orderedNonFoodCats}
                onReorder={reorderNonFoodCategories}
                scrollRef={scrollRef}
                renderItem={(cat) => {
                  const isOn = enabledNonFoodCategories.includes(cat.label);
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
                }}
              />
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

          {/* ── Emergency Contacts ── */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Emergency Contacts</Text>
            <TouchableOpacity
              style={styles.addContactBtn}
              onPress={openAddContact}
              accessibilityRole="button"
              accessibilityLabel="Add emergency contact"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={styles.addContactBtnLabel}>Add</Text>
            </TouchableOpacity>
          </View>
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

          {/* ── Govee API Key ── */}
          <Text style={styles.sectionLabel}>Govee API Key</Text>
          <View style={styles.card}>
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
          </View>

          {/* ── Xiaomi (Mi Home) Credentials ── */}
          <Text style={styles.sectionLabel}>Xiaomi (Mi Home)</Text>
          <View style={styles.card}>
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
          </View>

          {/* ── Danger zone ── */}
          <Text style={[styles.sectionLabel, { color: colors.danger }]}>Danger Zone</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.leaveButton} onPress={handleLeave} accessibilityRole="button">
              <Ionicons name="exit-outline" size={18} color={colors.danger} />
              <Text style={styles.leaveButtonLabel}>Leave Household</Text>
            </TouchableOpacity>
          </View>

          {/* ── Save ── */}
          <TouchableOpacity
            style={[styles.updateButton, saving && { opacity: 0.5 }]}
            onPress={handleSaveAll}
            disabled={saving}
            accessibilityRole="button"
          >
            <Text style={styles.updateButtonLabel}>{saving ? 'Saving…' : 'Update Changes'}</Text>
          </TouchableOpacity>

        </ScrollView>
      )}

      {/* ── Finance Category Modal ── */}
      <Modal
        visible={financeCatType !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setFinanceCatType(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {financeCatType === 'bill' ? 'Add Bill Category' : 'Add Expense Category'}
              </Text>
              <TouchableOpacity onPress={() => setFinanceCatType(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconPicker} contentContainerStyle={styles.iconPickerContent}>
              {FINANCE_ICONS.map((ic) => (
                <TouchableOpacity
                  key={ic}
                  style={[styles.iconOption, financeCatForm.icon === ic && styles.iconOptionSelected]}
                  onPress={() => setFinanceCatForm((f) => ({ ...f, icon: ic }))}
                  accessibilityRole="button"
                  accessibilityLabel={`Select icon ${ic}`}
                >
                  <Text style={styles.iconOptionText}>{ic}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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
        </View>
      </Modal>

      {/* ── Add Pantry Category Modal ── */}
      <Modal
        visible={catModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCatModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{catModalType === 'non-food' ? 'Add Non-Food Category' : 'Add Food Category'}</Text>
              <TouchableOpacity onPress={() => setCatModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconPicker} contentContainerStyle={styles.iconPickerContent}>
              {CATEGORY_ICONS.map((ic) => (
                <TouchableOpacity
                  key={ic}
                  style={[styles.iconOption, catForm.icon === ic && styles.iconOptionSelected]}
                  onPress={() => setCatForm((f) => ({ ...f, icon: ic }))}
                  accessibilityRole="button"
                  accessibilityLabel={`Select icon ${ic}`}
                >
                  <Text style={styles.iconOptionText}>{ic}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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
        </View>
      </Modal>

      {/* ── Contact Modal ── */}
      <Modal
        visible={!!contactModal}
        transparent
        animationType="slide"
        onRequestClose={() => setContactModal(null)}
      >
        <View style={styles.modalOverlay}>
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
            <Text style={styles.modalLabel}>Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.iconPicker} contentContainerStyle={styles.iconPickerContent}>
              {CONTACT_ICONS.map((ic) => (
                <TouchableOpacity
                  key={ic}
                  style={[styles.iconOption, contactForm.icon === ic && styles.iconOptionSelected]}
                  onPress={() => setContactForm((f) => ({ ...f, icon: ic }))}
                  accessibilityRole="button"
                  accessibilityLabel={`Select icon ${ic}`}
                >
                  <Text style={styles.iconOptionText}>{ic}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: 56, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navTitle: { ...type.h4, color: colors.textPrimary },

  scrollContent: { padding: spacing.xl, paddingBottom: 200, gap: spacing.md },

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

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  memberRowBorder: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: 0 },
  memberAvatar: {
    width: 30, height: 30, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  memberName:   { ...type.bodySm, color: colors.textPrimary, fontWeight: '600' },
  memberEmail:  { ...type.caption, color: colors.textTertiary, marginTop: 1 },
  memberBadges: { flexDirection: 'row', gap: 6 },
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
  iconPicker:        { marginVertical: 4 },
  iconPickerContent: { gap: 8, paddingVertical: 4 },
  iconOption: {
    width: 44, height: 44, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  iconOptionSelected: {
    borderColor: colors.accent, backgroundColor: colors.accentSoft,
  },
  iconOptionText: { fontSize: 22 },

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
