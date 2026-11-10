import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNavScrollProps } from '../../context/NavScrollContext';
import { useAlert } from '../../context/AlertContext';
import { useNotification } from '../../context/NotificationContext';
import useVisualViewportHeight from '../../hooks/useVisualViewportHeight';
import DatePickerInput from '../../components/DatePickerInput';
import {
  getHouseholdWithPrivate, subscribePriceEntries, subscribePantryItems,
  subscribeReceiptAliases, addPriceEntriesBatch, applyPantryReceiptOps,
  saveReceiptAliases,
} from '../../services/firestore';
import { parseReceipt } from '../../services/openrouter';
import {
  normalizeReceipt, matchReceiptLines, selectedTotal, toPriceEntryDocs,
  toPantryOps, findPantryMatch,
} from '../../utils/receiptImport';
import {
  buildAliasIndex, applyAliases, bindLineToItem, aliasDocsFromLines,
} from '../../utils/receiptAliases';
import {
  buildPriceHistory, recentStores, formatPrice, todayKey, itemKeyOf,
} from '../../utils/pricing';
import { PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS, withOverrides, categoryName, unitName } from '../../utils/categories';
import { DEFAULT_AI_MODEL, getAiModel, visionModels } from '../../utils/aiModels';
import { spacing, radius, type } from '../../theme/colors';
import { useIsDesktop, DESKTOP_MAX_CONTENT } from '../../navigation/TabBar';
import { t } from '../../i18n';
import { useLanguage } from '../../context/LanguageContext';
import useFormat from '../../hooks/useFormat';

// Read a picked file's bytes as base64. Works on web (blob: URI) and native
// (file:// URI) — mirrors StatementImportScreen, avoiding expo-file-system,
// which has no web implementation.
function uriToBase64(uri) {
  return fetch(uri)
    .then((res) => res.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(t('statement.readFileError')));
      reader.onload = () => {
        const result = String(reader.result);      // "data:<mime>;base64,XXXX"
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    }));
}

// ── Reviewed line ──────────────────────────────────────────────────────────────

function LineRow({
  line, index, expanded, onToggle, onTogglePantry, onExpand, onChange, onLink,
  units, categoryDefs, iconFor, linkResults, linkSearch, onLinkSearch, colors, styles,
}) {
  // Several known meanings for one printed line — the department-heading case.
  // Nothing is guessed here; the shopper picks.
  const needsChoice = !line.aliasApplied && line.aliasOptions?.length > 1;

  return (
    <View style={[styles.lineWrap, !line.include && !line.toPantry && styles.lineRowExcluded]}>
      <View style={styles.lineRow}>
        <TouchableOpacity
          onPress={onToggle}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: line.include }}
          accessibilityLabel={t('receipt.logPriceFor', { name: line.name })}
        >
          <View style={[styles.checkbox, line.include && styles.checkboxChecked]}>
            {line.include && <Ionicons name="checkmark" size={12} color="#fff" />}
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1, gap: 4 }}>
          <TextInput
            style={styles.lineName}
            value={line.name}
            onChangeText={(name) => onChange(index, { name })}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('receipt.nameForLine', { line: index + 1 })}
          />
          <View style={styles.lineTags}>
            {needsChoice && (
              <View style={[styles.tag, { backgroundColor: colors.warningSoft }]}>
                <Text style={[styles.tagLabel, { color: colors.warning }]}>{t('receipt.pickItem')}</Text>
              </View>
            )}
            {line.aliasApplied && (
              <View style={styles.pantryTag}>
                <Ionicons name="link-outline" size={11} color={colors.textSecondary} />
                <Text style={styles.lineHint} numberOfLines={1}>{line.rawName}</Text>
              </View>
            )}
            {line.matchedItem ? (
              <View style={[styles.tag, { backgroundColor: colors.successSoft }]}>
                <Text style={[styles.tagLabel, { color: colors.success }]}>
                  {line.matchedItem.itemName}
                </Text>
              </View>
            ) : (
              <View style={[styles.tag, { backgroundColor: colors.accentSoft }]}>
                <Text style={[styles.tagLabel, { color: colors.accent }]}>{t('receipt.newItem')}</Text>
              </View>
            )}
            {line.toPantry && (
              <View style={styles.pantryTag}>
                <Ionicons
                  name={line.pantryMatch ? 'add-circle-outline' : 'file-tray-stacked-outline'}
                  size={11}
                  color={colors.textSecondary}
                />
                <Text style={styles.lineHint}>
                  {line.pantryMatch ? t('receipt.onTopOf', { amount: `${line.pantryMatch.quantity} ${unitName(line.pantryMatch.unit)}` }) : t('receipt.toPantry')}
                </Text>
              </View>
            )}
            {line.lastPrice != null && (
              <Text style={styles.lineHint}>last {formatPrice(line.lastPrice)}</Text>
            )}
            {line.unitMismatch && (
              <Text style={[styles.lineHint, { color: colors.warning }]}>{t('receipt.differentUnit')}</Text>
            )}
          </View>
        </View>

        <View style={styles.lineNumbers}>
          <TextInput
            style={styles.lineQty}
            value={String(line.quantity)}
            onChangeText={(v) => onChange(index, { quantity: v.replace(/[^0-9.]/g, '') })}
            keyboardType="decimal-pad"
            accessibilityLabel={t('receipt.quantityFor', { name: line.name })}
          />
          <Text style={styles.lineUnit}>{unitName(line.unit)}</Text>
        </View>

        <TextInput
          style={styles.linePrice}
          value={String(line.price)}
          onChangeText={(v) => onChange(index, { price: v.replace(/[^0-9.]/g, '') })}
          keyboardType="decimal-pad"
          accessibilityLabel={t('receipt.priceFor', { name: line.name })}
        />

        <TouchableOpacity
          onPress={onExpand}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={t(expanded ? 'receipt.hideDetails' : 'receipt.showDetails', { name: line.name })}
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textTertiary}
          />
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.lineDetail}>
          <Text style={styles.detailLabel}>{t('receipt.printed')}</Text>
          <Text style={styles.rawText}>
            {line.rawName}{line.code ? `  ·  #${line.code}` : ''}
          </Text>

          {line.aliasOptions?.length > 1 && (
            <>
              <Text style={styles.warnText}>
                {t('receipt.meantDifferent')}
              </Text>
              <View style={styles.chipRow}>
                {line.aliasOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt.itemKey}
                    style={[styles.chip, line.itemKey === opt.itemKey && styles.chipActive]}
                    onPress={() => onLink(index, opt)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: line.itemKey === opt.itemKey }}
                  >
                    <Text style={[styles.chipLabel, line.itemKey === opt.itemKey && styles.chipLabelActive]}>
                      {opt.itemName}
                      {opt.lastPrice != null ? ` · ${formatPrice(opt.lastPrice)}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.detailLabel}>{t('receipt.linkTracked')}</Text>
          <TextInput
            style={styles.textInput}
            value={linkSearch}
            onChangeText={onLinkSearch}
            placeholder={t('receipt.searchItems')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('receipt.searchLinkA11y')}
          />
          <View style={styles.chipRow}>
            {linkResults.map((target) => (
              <TouchableOpacity
                key={target.itemKey}
                style={[styles.chip, line.itemKey === target.itemKey && styles.chipActive]}
                onPress={() => onLink(index, target)}
                accessibilityRole="button"
                accessibilityState={{ selected: line.itemKey === target.itemKey }}
              >
                <Text style={[styles.chipLabel, line.itemKey === target.itemKey && styles.chipLabelActive]}>
                  {target.itemName}
                </Text>
              </TouchableOpacity>
            ))}
            {linkResults.length === 0 && (
              <Text style={styles.lineHint}>
                {t('receipt.noMatch')}
              </Text>
            )}
          </View>
          <Text style={styles.lineHint}>
            {t('receipt.remembered', { name: line.rawName })}
          </Text>

          <Text style={styles.detailLabel}>{t('receipt.unit')}</Text>
          <View style={styles.chipRow}>
            {units.map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.chip, line.unit === u && styles.chipActive]}
                onPress={() => onChange(index, { unit: u })}
                accessibilityRole="button"
                accessibilityState={{ selected: line.unit === u }}
              >
                <Text style={[styles.chipLabel, line.unit === u && styles.chipLabelActive]}>{unitName(u)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.detailLabel}>{t('receipt.category')}</Text>
          <View style={styles.chipRow}>
            {categoryDefs.map((cat) => (
              <TouchableOpacity
                key={cat.label}
                style={[styles.chip, line.category === cat.label && styles.chipActive]}
                onPress={() => onChange(index, { category: cat.label })}
                accessibilityRole="button"
                accessibilityState={{ selected: line.category === cat.label }}
              >
                <Text style={[styles.chipLabel, line.category === cat.label && styles.chipLabelActive]}>
                  {iconFor(cat.label)} {categoryName(cat.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.pantryToggle}
            onPress={onTogglePantry}
            accessibilityRole="switch"
            accessibilityState={{ checked: line.toPantry }}
            accessibilityLabel={t('receipt.addToPantryA11y', { name: line.name })}
          >
            <View style={[styles.checkbox, line.toPantry && styles.checkboxChecked]}>
              {line.toPantry && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pantryToggleLabel}>{t('receipt.addToPantry')}</Text>
              {line.pantryMatch && (
                <Text style={styles.lineHint}>
                  {t('receipt.topsUp', { name: line.pantryMatch.name, amount: `${line.pantryMatch.quantity} ${unitName(line.pantryMatch.unit)}` })}
                </Text>
              )}
            </View>
          </TouchableOpacity>

          {line.toPantry && (
            <>
              <Text style={styles.detailLabel}>{t('receipt.expiresOptional')}</Text>
              <DatePickerInput
                value={line.expiryDate}
                onChange={(expiryDate) => onChange(index, { expiryDate })}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function ReceiptImportScreen({ navigation }) {
  const { householdId, user } = useAuth();
  const { colors } = useTheme();
  useLanguage();
  useFormat();
  const { showAlert } = useAlert();
  const { notify } = useNotification();
  const isDesktop = useIsDesktop();
  const windowHeight = useVisualViewportHeight();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navScrollProps = useNavScrollProps();

  const [apiKey, setApiKey]   = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [entries, setEntries] = useState([]);
  const [pantryItems, setPantryItems] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [units, setUnits] = useState(UNITS);
  const [categoryDefs, setCategoryDefs] = useState([
    ...PANTRY_CATEGORIES, ...NON_FOOD_CATEGORIES,
  ]);
  // Categories that default to *not* being stocked — kept separate from
  // categoryDefs because a custom non-food category is otherwise
  // indistinguishable from a custom food one once the two lists are merged.
  const [nonFoodLabels, setNonFoodLabels] = useState(
    NON_FOOD_CATEGORIES.map((c) => c.label),
  );

  const [file, setFile]           = useState(null);   // { uri, name, mimeType }
  const [analyzing, setAnalyzing] = useState(false);
  const [lines, setLines]         = useState(null);   // null = not analyzed yet
  const [expanded, setExpanded]   = useState(null);   // index of the open line
  const [linkSearch, setLinkSearch] = useState('');    // item search in the open line
  const [store, setStore]         = useState('');
  const [date, setDate]           = useState('');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!householdId) return;
    getHouseholdWithPrivate(householdId).then((hh) => {
      setApiKey(hh?.openRouterApiKey ?? '');
      setAiModel(hh?.aiModel ?? DEFAULT_AI_MODEL);
      // Same unit/category choices the grocery and pantry screens offer.
      setUnits([...(hh?.enabledUnits ?? UNITS), ...(hh?.customUnits ?? [])]);
      const nonFood = [...withOverrides(NON_FOOD_CATEGORIES, hh?.nonFoodCategoryOverrides), ...(hh?.nonFoodCustomCategories ?? [])];
      setCategoryDefs([
        ...withOverrides(PANTRY_CATEGORIES, hh?.pantryCategoryOverrides), ...(hh?.pantryCustomCategories ?? []), ...nonFood,
      ]);
      setNonFoodLabels(nonFood.map((c) => c.label));
    }).catch(() => { /* surfaced when analyzing; pickers fall back to defaults */ });

    const unsubPrices  = subscribePriceEntries(householdId, setEntries);
    const unsubPantry  = subscribePantryItems(householdId, setPantryItems);
    const unsubAliases = subscribeReceiptAliases(householdId, setAliases);
    return () => { unsubPrices(); unsubPantry(); unsubAliases(); };
  }, [householdId]);

  const history = useMemo(() => buildPriceHistory(entries), [entries]);
  const stores  = useMemo(() => recentStores(entries, 12), [entries]);
  const aliasIndex = useMemo(() => buildAliasIndex(aliases), [aliases]);

  // Everything a receipt line can be linked to: priced items first, plus
  // pantry-only items that have never been through the price tracker.
  const linkTargets = useMemo(() => {
    const byKey = new Map(history.map((item) => [
      item.itemKey, { itemKey: item.itemKey, itemName: item.itemName, category: item.category },
    ]));
    for (const item of pantryItems) {
      const key = itemKeyOf(item?.name);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, { itemKey: key, itemName: item.name, category: item.category });
    }
    return [...byKey.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [history, pantryItems]);

  const linkResults = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    const pool = q
      ? linkTargets.filter((t) => t.itemName.toLowerCase().includes(q))
      : linkTargets;
    return pool.slice(0, 20);
  }, [linkTargets, linkSearch]);

  const iconFor = useMemo(() => {
    const map = new Map(categoryDefs.map((c) => [c.label, c.icon]));
    return (label) => map.get(label) ?? '🛒';
  }, [categoryDefs]);

  const model     = getAiModel(aiModel);
  const isPdf     = /pdf/i.test(file?.mimeType || '');
  const needsVision = !!file && !isPdf && !model?.vision;

  const total = useMemo(() => selectedTotal(lines ?? []), [lines]);
  const includedCount = (lines ?? []).filter((l) => l.include).length;
  const pantryCount   = (lines ?? []).filter((l) => l.toPantry).length;

  const takeFile = (asset) => {
    setFile(asset);
    setLines(null);
    setExpanded(null);
  };

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;
      takeFile(res.assets[0]);
    } catch {
      showAlert({ title: t('receipt.openFileError'), message: t('receipt.openFileMessage'), type: 'error' });
    }
  };

  // Shoot the receipt straight from the phone camera. Native only — on web the
  // file picker already covers "upload a photo", and a webcam shot of a till
  // receipt is never the flow anyone wants.
  const shootReceipt = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showAlert({
          title: t('receipt.cameraNeeded'),
          message: t('receipt.cameraNeededMessage'),
          type: 'warning',
        });
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,           // a till receipt stays legible, the upload stays small
        allowsEditing: true,    // crop away the counter before it costs vision tokens
      });
      if (res.canceled || !res.assets?.length) return;
      const shot = res.assets[0];
      takeFile({
        uri: shot.uri,
        name: shot.fileName || 'receipt.jpg',
        mimeType: shot.mimeType || 'image/jpeg',
      });
    } catch (e) {
      showAlert({ title: t('receipt.cameraError'), message: e.message, type: 'error' });
    }
  };

  const analyze = async () => {
    if (!file) return;
    if (!apiKey) {
      showAlert({
        title: t('receipt.noApiKey'),
        message: t('receipt.noApiKeyMessage'),
        type: 'error',
      });
      return;
    }
    setAnalyzing(true);
    try {
      const base64 = await uriToBase64(file.uri);
      const parsed = await parseReceipt(apiKey, { base64, mimeType: file.mimeType }, aiModel);
      const receipt = normalizeReceipt(parsed);
      if (!receipt.lines.length) {
        showAlert({
          title: t('receipt.nothingFound'),
          message: t('receipt.nothingFoundMessage'),
          type: 'warning',
        });
        return;
      }
      const shopStore = receipt.store || stores[0] || '';
      // Aliases first: they rewrite a line's identity, and everything after —
      // history match, category, pantry match — keys off that identity.
      const aliased = applyAliases(receipt.lines, aliasIndex, { store: shopStore });
      setLines(matchReceiptLines(aliased, history, {
        pantryItems,
        nonFoodCategories: nonFoodLabels,
      }));
      setStore(shopStore);
      setDate(receipt.date || todayKey());
    } catch (e) {
      showAlert({ title: t('receipt.readError'), message: e.message, type: 'error' });
    } finally {
      setAnalyzing(false);
    }
  };

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      const next = { ...line, ...patch };
      // Editing the name or unit can change which pantry row this tops up, so
      // re-link rather than leaving the parse-time match in place.
      if (patch.name !== undefined || patch.unit !== undefined) {
        next.itemKey     = itemKeyOf(next.name);
        next.pantryMatch = findPantryMatch(next, pantryItems);
      }
      return next;
    }));
  };

  const toggleLine = (index) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, include: !line.include } : line)));
  };

  const togglePantry = (index) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, toPantry: !line.toPantry } : line)));
  };

  // Point a line at a tracked item — a suggestion chip, or a hit from the link
  // search. This is what teaches the alias table; the raw receipt text on the
  // line is untouched, so the mapping saved at import is the useful direction.
  const linkLine = (index, target) => {
    setLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      const bound = bindLineToItem(line, target);
      return { ...bound, pantryMatch: findPantryMatch(bound, pantryItems) };
    }));
    setLinkSearch('');
  };

  const openLine = (index) => {
    setExpanded(expanded === index ? null : index);
    setLinkSearch('');
  };

  const save = async () => {
    const docs = toPriceEntryDocs(lines, { store, date, addedBy: user.uid });
    const pantryOps = toPantryOps(lines, { addedBy: user.uid });
    const pantryTotal = pantryOps.creates.length + pantryOps.merges.length;

    if (!docs.length && !pantryTotal) {
      showAlert({
        title: t('receipt.nothingToImport'),
        message: t('receipt.nothingToImportMessage'),
        type: 'warning',
      });
      return;
    }
    setSaving(true);
    try {
      // Two batches rather than one: they hit different collections and a
      // partial failure is worth reporting precisely, not rolling back a good
      // price import because one pantry row vanished mid-scan.
      await addPriceEntriesBatch(householdId, docs);
      await applyPantryReceiptOps(householdId, pantryOps);
      // Remember what this receipt's printed lines turned out to mean, so the
      // next one recognises them without being told again. Best-effort: a
      // failure here costs the next import a bit of typing, not this import.
      await saveReceiptAliases(householdId, aliasDocsFromLines(lines, { store }))
        .catch(() => { /* the import itself already succeeded */ });

      const parts = [];
      if (docs.length)   parts.push(t('receipt.pricesLogged', { count: docs.length }));
      if (pantryTotal)   parts.push(t('receipt.pantryStocked', { count: pantryTotal }));
      notify(t('receipt.imported'), t('receipt.importedFrom', { parts: parts.join(' · '), store: store || t('receipt.thisReceipt') }), { type: 'success' });
      navigation.goBack();
    } catch (e) {
      showAlert({ title: t('common.error'), message: e.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.root,
        Platform.OS === 'android' && { paddingTop: 24 },
        // Web: pin to the viewport so the ScrollView has a real bounded height.
        Platform.OS === 'web' && { height: windowHeight },
      ]}
    >
      <ScrollView
        style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
        contentContainerStyle={[styles.container, isDesktop && styles.containerDesktop]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...navScrollProps}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('receipt.back')}
          >
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('receipt.title')}</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* Pick + analyze */}
        <View style={styles.card}>
          {Platform.OS !== 'web' && (
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={shootReceipt}
              accessibilityRole="button"
              accessibilityLabel={t('receipt.photographA11y')}
            >
              <Ionicons name="camera-outline" size={18} color="#fff" />
              <Text style={styles.cameraButtonLabel}>{t('receipt.photograph')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.pickButton} onPress={pickFile} accessibilityRole="button">
            <Ionicons name="receipt-outline" size={18} color={colors.accent} />
            <Text style={styles.pickButtonLabel} numberOfLines={1}>
              {file ? file.name : t('receipt.choose')}
            </Text>
          </TouchableOpacity>

          {needsVision && (
            <Text style={styles.warnText}>
              {t('receipt.cantReadImages', {
                model: model?.label ?? t('receipt.selectedModel'),
                models: visionModels().map((m) => m.label).join(t('receipt.or')),
              })}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryButton, (!file || analyzing || needsVision) && styles.buttonDisabled]}
            onPress={analyze}
            disabled={!file || analyzing || needsVision}
            accessibilityRole="button"
          >
            {analyzing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.primaryButtonLabel}>{t('receipt.read')}</Text>}
          </TouchableOpacity>
          <Text style={styles.hintText}>
            {t('receipt.reviewHint')}
          </Text>
        </View>

        {/* Review */}
        {lines && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('receipt.shopDetails')}</Text>
              <Text style={styles.inputLabel}>{t('receipt.store')}</Text>
              <TextInput
                style={styles.textInput}
                value={store}
                onChangeText={setStore}
                placeholder={t('grocery.storePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={t('receipt.store')}
              />
              {stores.length > 0 && (
                <View style={styles.chipRow}>
                  {stores.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, store === s && styles.chipActive]}
                      onPress={() => setStore(s)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: store === s }}
                    >
                      <Text style={[styles.chipLabel, store === s && styles.chipLabelActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.inputLabel}>{t('receipt.purchaseDate')}</Text>
              <DatePickerInput value={date} onChange={setDate} />
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{t('receipt.lines')}</Text>
                <Text style={styles.cardHint}>
                  {t('receipt.pricedCount', { priced: includedCount, pantry: pantryCount })}
                </Text>
              </View>
              {lines.map((line, i) => (
                <LineRow
                  key={i}
                  line={line}
                  index={i}
                  expanded={expanded === i}
                  onToggle={() => toggleLine(i)}
                  onTogglePantry={() => togglePantry(i)}
                  onExpand={() => openLine(i)}
                  onChange={updateLine}
                  onLink={linkLine}
                  units={units}
                  categoryDefs={categoryDefs}
                  iconFor={iconFor}
                  linkResults={linkResults}
                  linkSearch={linkSearch}
                  onLinkSearch={setLinkSearch}
                  colors={colors}
                  styles={styles}
                />
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{t('receipt.selectedTotal')}</Text>
                <Text style={styles.totalValue}>{formatPrice(total)}</Text>
              </View>
              <Text style={styles.hintText}>
                {t('receipt.totalHint')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.buttonDisabled]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryButtonLabel}>
                    {t('receipt.importPrices', { count: includedCount })}
                    {pantryCount > 0 ? t('receipt.toPantryCount', { count: pantryCount }) : ''}
                  </Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  container: {
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
    paddingBottom: 230, gap: spacing.md,
  },
  containerDesktop: { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title:  { ...type.h3, color: colors.textPrimary, flex: 1 },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle:  { ...type.h4, color: colors.textPrimary },
  cardHint:   { ...type.caption, color: colors.textTertiary },

  pickButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.lg, height: 50,
  },
  pickButtonLabel: { ...type.body, color: colors.textPrimary, flex: 1 },

  cameraButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: radius.md, backgroundColor: colors.accent,
  },
  cameraButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },

  primaryButton: {
    height: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.accent,
  },
  primaryButtonLabel: { ...type.bodyMed, color: '#fff', fontWeight: '700' },
  buttonDisabled:     { opacity: 0.45 },

  hintText: { ...type.caption, color: colors.textTertiary },
  warnText: { ...type.caption, color: colors.warning },

  inputLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  textInput: {
    height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, ...type.body, color: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
  },

  // Wrapping View rather than a nested horizontal ScrollView — a nested
  // horizontal scroll blocks the outer vertical scroll on web.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive:      { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipLabel:       { ...type.label, color: colors.textSecondary },
  chipLabelActive: { color: colors.accent },

  lineWrap: { borderTopWidth: 1, borderTopColor: colors.border },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
  },
  lineRowExcluded: { opacity: 0.45 },

  lineDetail: {
    gap: spacing.sm, paddingBottom: spacing.md, paddingLeft: 30,
  },
  detailLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  rawText: {
    ...type.bodySm, color: colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6,
  },
  pantryTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pantryToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6,
  },
  pantryToggleLabel: { ...type.bodyMed, color: colors.textPrimary },
  checkbox: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  lineName: {
    ...type.bodyMed, color: colors.textPrimary,
    paddingVertical: 2, paddingHorizontal: 0,
  },
  lineTags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full },
  tagLabel:  { ...type.caption, fontWeight: '700' },
  lineHint:  { ...type.caption, color: colors.textTertiary },

  lineNumbers: { alignItems: 'center', width: 54 },
  lineQty: {
    ...type.bodySm, color: colors.textPrimary, textAlign: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.border,
    minWidth: 40, paddingVertical: 2,
  },
  lineUnit: { ...type.caption, color: colors.textTertiary },
  linePrice: {
    ...type.bodyMed, color: colors.textPrimary, textAlign: 'right',
    borderBottomWidth: 1, borderBottomColor: colors.border,
    width: 64, paddingVertical: 2,
  },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md,
  },
  totalLabel: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase' },
  totalValue: { ...type.h4, color: colors.textPrimary },
});
