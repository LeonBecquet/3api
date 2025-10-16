# 1) Créer un user (public)
$reg = Invoke-WebRequest -Uri "$BASE/users" -Method POST `
  -Body '{"email":"leon@test.com","username":"test","password":"test123"}' `
  -ContentType "application/json" | ConvertFrom-Json
$reg

# 2) Se connecter (public) -> renvoie l'USER (PAS de token)
$login = Invoke-WebRequest -Uri "$BASE/auth/login" -Method POST `
  -Body '{"email":"leon@test.com","password":"test123"}' `
  -ContentType "application/json" | ConvertFrom-Json
$login

# 3) Récupérer mon ID (à réutiliser en X-User-Id pour les routes protégées)
$ME_ID = $login.user._id
"ME_ID = $ME_ID"

# 4) Lire mon profil (self) — besoin de l'en-tête X-User-Id
Invoke-WebRequest -Uri "$BASE/users/$ME_ID" -Headers @{ "X-User-Id" = $ME_ID } | ConvertFrom-Json

# --- À partir d'ici, il faut être ADMIN pour créer/éditer restaurants & menus ---

# (Option A) Promouvoir via MongoDB (en 1 ligne mongosh) :
# Remplace DB_NAME si tu as changé (par défaut "foodexpress")
# mongosh --eval "use foodexpress; db.users.updateOne({_id:ObjectId('$ME_ID')},{\$set:{role:'admin'}})"

# (Option B) Ouvre MongoDB Compass et change le champ `role` du user en "admin"

# 5) Créer un restaurant (ADMIN)
$rest = Invoke-WebRequest -Uri "$BASE/restaurants" -Method POST `
  -Headers @{ "X-User-Id" = $ME_ID; "Content-Type" = "application/json" } `
  -Body '{"name":"Pasta Co","address":"1 Main St","phone":"0102030405","opening_hours":"Mon-Fri 12:00-22:00"}' `
  | ConvertFrom-Json
$rest
$REST_ID = $rest._id

# 6) Lister les restaurants (PUBLIC) avec tri/pagination
Invoke-WebRequest -Uri "$BASE/restaurants?sort=name&order=asc&page=1&limit=10" | ConvertFrom-Json

# 7) Créer un menu pour ce restaurant (ADMIN)
$menu = Invoke-WebRequest -Uri "$BASE/menus" -Method POST `
  -Headers @{ "X-User-Id" = $ME_ID; "Content-Type" = "application/json" } `
  -Body ("{""restaurant_id"":""$REST_ID"",""name"":""Lasagna"",""description"":""Homemade"",""price"":12.5,""category"":""italian""}") `
  | ConvertFrom-Json
$menu
$MENU_ID = $menu._id

# 8) Lister les menus (PUBLIC) (tri et filtre restaurant_id)
Invoke-WebRequest -Uri "$BASE/menus?sort=price&order=desc&restaurant_id=$REST_ID&page=1&limit=10" | ConvertFrom-Json

# 9) (Exemples) Update & Delete
# Update mon username (self)
Invoke-WebRequest -Uri "$BASE/users/$ME_ID" -Method PUT `
  -Headers @{ "X-User-Id" = $ME_ID; "Content-Type" = "application/json" } `
  -Body '{"username":"test2"}' | ConvertFrom-Json

# Update restaurant (ADMIN)
Invoke-WebRequest -Uri "$BASE/restaurants/$REST_ID" -Method PUT `
  -Headers @{ "X-User-Id" = $ME_ID; "Content-Type" = "application/json" } `
  -Body '{"opening_hours":"Daily 12:00-23:00"}' | ConvertFrom-Json

# Delete menu (ADMIN)
Invoke-WebRequest -Uri "$BASE/menus/$MENU_ID" -Method DELETE `
  -Headers @{ "X-User-Id" = $ME_ID } | ConvertFrom-Json