# SENTORIA — boutique artisanale / Cloudflare Pages

Projet complet de **prépublication**. Boutique statique premium + Pages Functions + D1 + Stripe Checkout + authentification administrateur à code e-mail + notifications Resend + statistiques RGPD opt-in.

## IMPORTANT — état du projet

- **La boutique est désactivée par défaut** (`STORE_ENABLED=false`, `PAYMENTS_ENABLED=false`). Les produits, prix, parfums, photos stylisées et stocks sont des **données de démonstration** : les remplacer avant toute vente.
- Les pages juridiques contiennent des champs obligatoires `[À COMPLÉTER]`. Le projet **ne garantit pas la conformité légale** tant qu'ils ne sont pas remplis et validés avec l'accompagnateur LJE, notamment l'identité juridique, la TVA, les prix TTC, les caractéristiques et étiquetages de sécurité des bougies (CLP selon leur composition et obligations applicables), les options de livraison, les retours et la protection des données.
- Aucun hébergement, paiement, compte Stripe, compte Cloudflare ou domaine ne peut être créé automatiquement à partir de ce ZIP. Le déploiement réel sera fait dans une phase ultérieure.

## Architecture

`public/` : HTML / CSS / JS, sans framework ni CDN. `functions/api/[[path]].js` : API Cloudflare Pages Functions. `migrations/0001_init.sql` : schéma D1 et catalogue fictif. `wrangler.jsonc` : configuration Cloudflare Pages.

## Installation locale

1. Installer Node.js 20+ et exécuter `npm install`.
2. Créer la base Cloudflare D1 : `npx wrangler d1 create sentoria-db`. Copier l'identifiant retourné dans `wrangler.jsonc` (à la place de `REPLACE_WITH_YOUR_D1_DATABASE_ID`).
3. Copier `.dev.vars.example` vers `.dev.vars`, puis renseigner les secrets. Ne jamais committer `.dev.vars`.
4. `npm run db:local` pour créer le schéma local ; `npm run dev` pour lancer la preview Pages sur `http://localhost:8788`.
5. Visiter `http://localhost:8788` et `/admin`.

**Note :** en local, les cookies `Secure` exigent HTTPS pour les navigateurs qui ne traitent pas localhost comme contexte sûr. Pour une vérification complète du login, privilégier l'URL HTTPS Pages de test. La configuration `SITE_URL` doit correspondre exactement à l'origine d'accès (protection CSRF).

## Configuration Cloudflare lors de la publication

1. Créer un projet **Cloudflare Pages** lié au dépôt git, dossier de sortie `public`, sans build (ou déployer avec `npm run deploy`). Fournir `wrangler.jsonc` et la base D1.
2. Sur Pages, ajouter les secrets : `ADMIN_EMAIL` (seule adresse autorisée), `ADMIN_OTP_SECRET` (secret aléatoire fort), `RESEND_API_KEY`, `MAIL_FROM` (adresse sur domaine vérifié Resend), `CONTACT_EMAIL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Toutes les clés secrètes doivent rester côté serveur.
3. `SITE_URL` doit être l'origine HTTPS réelle, sans chemin (ex. `https://sentoria.be`), y compris pour les liens de retour Stripe et les vérifications Origin. Configurez les variables d'environnement correspondantes dans Pages pour preview/production ; ne gardez pas `localhost` en production.
4. Initialiser la base **distante** avec `npm run db:remote` puis saisir les vraies références des produits (noms, descriptions, ingrédients, mentions légales, stocks, prix). Les textes du catalogue fictif ne sont pas adaptés à une vente réelle.
5. Configurer le webhook Stripe `https://votre-domaine/api/stripe-webhook`, événement `checkout.session.completed`. Utiliser les clés `sk_test_...` pendant les essais, passer en live uniquement après validation juridique. Le code ne traite pour l'instant que les paiements immédiatement `paid` à cet événement. **Désactiver les méthodes de paiement asynchrones** dans Stripe tant que les événements `checkout.session.async_payment_succeeded` et échecs associés ne sont pas implémentés.
6. Renseigner, vérifier et tester deux modes de livraison réellement disponibles (domicile et point de retrait) et leurs tarifs `SHIPPING_HOME_CENTS`, `SHIPPING_PICKUP_CENTS`. Les deux modes de la maquette sont indicatifs. Stripe gère l'encaissement ; les étiquettes de transport ne sont pas créées automatiquement.
7. Après tests complets et autorisation LJE, activer `PAYMENTS_ENABLED=true` et `STORE_ENABLED=true` (les deux sont nécessaires).

## Administration

`/admin` n'affiche pas les commandes sans authentification. Seul `ADMIN_EMAIL` peut recevoir un OTP de 6 chiffres (10 min, 5 essais par code, garde-fous IP / e-mail), puis une session de 8 h via cookie HttpOnly Secure SameSite Strict. Les endpoints sensibles vérifient la session. Ne partagez jamais vos codes OTP, l'adresse admin, ni les secrets.

Fonctions : voir les 100 dernières commandes, changer le statut, modifier nom/prix/stock/visibilité des produits, voir les conversions avec taux calculés réellement. Un e-mail client et un e-mail administrateur sont déclenchés après confirmation Stripe. Les échecs de livraison e-mail sont journalisés mais ne garantissent pas un renvoi automatique. Les commandes restent dans D1.

## Mesures des parcours utilisateurs

Comptage des **visiteurs uniques par étape** (sur l'ensemble des sessions), uniquement après consentement explicite. Visite → panier vu → ajout panier → début paiement. Le taux est `visiteurs_étape / visiteurs_visit * 100` (pas de données inventées) ; les achats payés sont affichés à part car comptés au niveau des commandes Stripe, sans associer les sessions anonymes aux transactions. Le funnel n'est **pas cohorté** et une étape peut se produire sans autre étape; les proportions peuvent dépasser 100 % dans certains cas. Ne pas interpréter ce tableau comme une conversion achat précise.

## Sécurité et limites restantes

- Pas de carte bancaire stockée ; prix, stock et livraison recalculés côté serveur ; webhook Stripe vérifié par HMAC et délai 5 min ; header CSP et protections navigateur ; contrôle de l'origine sur les écritures ; sessions hachées, délais OTP, cookies stricts ; base avec requêtes paramétrées ; texte utilisateur échappé dans les e-mails.
- **À renforcer avant lancement commercial :** réservation atomique de stock et gestion des sessions de paiement abandonnées, traitement exhaustif des événements Stripe (paiements différés, remboursements, litiges), système de relance email, journal d'audit, alertes d'erreurs, purge RGPD périodique, backup D1, contrôle anti-bot Cloudflare Turnstile/rate limiting sur les formulaires publics, mentions produit/sécurité et tests E2E. Le stock peut être sur-vendu en cas de deux paiements concomitants ; une commande est alors marquée `manual_review` et nécessite intervention/remboursement. Les remboursements ne sont **pas déclenchés automatiquement** par le changement de statut admin.
- L'endpoint de rétractation `/api/withdrawal` évite d'indiquer si une commande existe. Vérifier la demande et les délais avec le client ; la soumission nécessite l'e-mail et l'UUID exact de la commande.
- Mettre en place la suppression des événements au-delà de la durée annoncée et suppression des commandes selon obligations de conservation. Penser aux accords de traitement des données (Cloudflare, Stripe, Resend), à une adresse publique de contact et à un moyen de gestion des réclamations.

## Sources réglementaires officielles

- SPF Économie (e-commerce) : https://economie.fgov.be/fr/themes/ventes/formes-de-vente/ventes-par-internet-e-commerce
- FAQ e-commerce : https://economie.fgov.be/fr/themes/entreprises/guidance/pratiques-commerciales/obligations-dinformation-dans/questions-frequemment-posees
- LJE (mini-entreprise) : https://lje.be/fr/mini-entreprise

## Modifier le design

Les couleurs, animations et styles sont dans `public/styles.css`. La page principale et les textes sont dans `public/index.html`, les interactions dans `public/app.js`. Le design des bougies est créé en CSS ; remplacez-le par des photographies originales de vos vrais produits avant le lancement commercial.
