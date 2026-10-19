import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { View, ActivityIndicator } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import CustomTabBar, { useIsDesktop, SIDEBAR_WIDTH } from './TabBar';
import { navigationRef } from './navigationRef';

import SignInScreen         from '../screens/auth/SignInScreen';
import HouseholdScreen      from '../screens/auth/HouseholdScreen';
import HomeScreen           from '../screens/home/HomeScreen';
import GroceryListScreen    from '../screens/grocery/GroceryListScreen';
import PriceHistoryScreen   from '../screens/grocery/PriceHistoryScreen';
import PriceDetailScreen    from '../screens/grocery/PriceDetailScreen';
import ReceiptImportScreen  from '../screens/grocery/ReceiptImportScreen';
import RecipesScreen        from '../screens/recipes/RecipesScreen';
import RecipeDetailScreen   from '../screens/recipes/RecipeDetailScreen';
import AddRecipeScreen      from '../screens/recipes/AddRecipeScreen';

import PantryScreen         from '../screens/pantry/PantryScreen';
import NutritionScreen      from '../screens/nutrition/NutritionScreen';
import BodyGoalsScreen      from '../screens/nutrition/BodyGoalsScreen';
import ProfileScreen        from '../screens/settings/ProfileScreen';
import HouseholdEditScreen  from '../screens/settings/HouseholdEditScreen';
import HomeLightsScreen         from '../screens/lights/HomeLightsScreen';
import EmergencyContactsScreen from '../screens/emergency/EmergencyContactsScreen';
import XiaomiScreen            from '../screens/xiaomi/XiaomiScreen';
import BillsExpensesScreen     from '../screens/bills/BillsExpensesScreen';
import StatementImportScreen   from '../screens/bills/StatementImportScreen';
import AIScreen                from '../screens/ai/AIScreen';
const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileHome"    component={ProfileScreen} />
      <Stack.Screen name="HouseholdEdit"  component={HouseholdEditScreen} />
    </Stack.Navigator>
  );
}

function BillsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BillsHome"       component={BillsExpensesScreen}  />
      <Stack.Screen name="StatementImport" component={StatementImportScreen} />
    </Stack.Navigator>
  );
}

function GroceryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="GroceryHome"  component={GroceryListScreen}  />
      <Stack.Screen name="PriceHistory" component={PriceHistoryScreen} />
      <Stack.Screen name="PriceDetail"   component={PriceDetailScreen}   />
      <Stack.Screen name="ReceiptImport" component={ReceiptImportScreen} />
    </Stack.Navigator>
  );
}

function RecipesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RecipesHome"   component={RecipesScreen}      />
      <Stack.Screen name="RecipeDetail"  component={RecipeDetailScreen} />
      <Stack.Screen name="AddRecipe"     component={AddRecipeScreen}    />
    </Stack.Navigator>
  );
}

function NutritionStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="NutritionHome" component={NutritionScreen} />
      <Stack.Screen name="BodyGoals"     component={BodyGoalsScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  const isDesktop = useIsDesktop();
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      sceneContainerStyle={isDesktop ? { paddingLeft: SIDEBAR_WIDTH } : undefined}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home"      component={HomeScreen}        />
      <Tab.Screen name="Grocery"   component={GroceryStack}      />
      <Tab.Screen name="Recipes"   component={RecipesStack}      />
      <Tab.Screen name="Pantry"    component={PantryScreen}      />
      <Tab.Screen name="Nutrition"  component={NutritionStack}    />
      <Tab.Screen name="AI"                component={AIScreen}                 />
      <Tab.Screen name="HomeLights"        component={HomeLightsScreen}         />
      <Tab.Screen name="Xiaomi"            component={XiaomiScreen}             />
      <Tab.Screen name="Bills"             component={BillsStack}               />
      <Tab.Screen name="EmergencyContacts" component={EmergencyContactsScreen}  />
      <Tab.Screen name="Profile"           component={ProfileStack}             />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, householdId, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="SignIn"    component={SignInScreen}    />
        ) : !householdId ? (
          <Stack.Screen name="Household" component={HouseholdScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
