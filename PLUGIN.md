# kMoney

A modern, feature-rich economy plugin for Paper 1.21+. Balances are stored per-player in YAML files and cached in memory for fast access. Fully compatible with Vault and PlaceholderAPI.

---

## Commands

All subcommands are accessible under `/money`. The root command `/balance` is an alias for `/money`.

| Command | Description | Permission |
|---|---|---|
| `/money` | Show your own balance | `kmoney.command.money` |
| `/money balance` | Show your own balance | `kmoney.command.money` |
| `/money balance <player>` | Show another player's balance | `kmoney.command.money` |
| `/money pay <player> <amount>` | Send money to another player | `kmoney.command.money.pay` |
| `/money top [page]` | Show the richest players (paginated, 10 per page) | `kmoney.command.money.top` |
| `/money withdraw <amount\|all> [notes]` | Convert balance into a physical money check item | `kmoney.command.money.withdraw` |
| `/money add <player> <amount>` | Add money to a player's balance | `kmoney.command.money.add` |
| `/money remove <player> <amount\|all>` | Remove money from a player's balance | `kmoney.command.money.remove` |
| `/money set <player> <amount>` | Set a player's balance to an exact value | `kmoney.command.money.set` |
| `/money admin <on\|off>` | Toggle your own admin join notification | `kmoney.command.money.admin` |
| `/money reload` | Reload all configuration files | `kmoney.command.money.reload` |

### Amount format

All amount arguments accept the following shorthand suffixes (case-insensitive):

| Input | Value |
|---|---|
| `100` | 100 |
| `1k` | 1,000 |
| `1m` | 1,000,000 |
| `1b` | 1,000,000,000 |
| `1t` | 1e12 |
| `1q` | 1e15 |
| … | up to `tvg` = 1e72 |

Comma-separated numbers (`1,000,000`) are also accepted. The keyword `all` is supported by `/money remove` and `/money withdraw` to use the full balance.

---

## Permissions

| Permission | Default | Description |
|---|---|---|
| `kmoney.command.money` | everyone | Balance checks |
| `kmoney.command.money.pay` | everyone | Pay other players |
| `kmoney.command.money.top` | everyone | View rich list |
| `kmoney.command.money.withdraw` | everyone | Create money checks |
| `kmoney.command.money.add` | op | Add money to players |
| `kmoney.command.money.remove` | op | Remove money from players |
| `kmoney.command.money.set` | op | Set player balances |
| `kmoney.command.money.admin` | op | Toggle admin join message |
| `kmoney.command.money.reload` | op | Reload configuration |
| `kmoney.admin` | op | Grants all of the above |

---

## Money Checks

A money check is a physical in-game item (default: Paper) that represents a fixed monetary value. Players use `/money withdraw` to convert balance into checks, which can then be traded, dropped, or stored. Right-clicking a check claims its value and deposits it into the holder's balance.

- The item material is configurable (`check-material` in `config.yml`).
- The `/money withdraw <amount> <notes>` variant creates a stack of up to 64 checks, each worth `amount`. The total cost is `amount × notes`.
- Item lore shows the per-note value and the creator's name.
- Checks are protected against duplication through hoppers, villager trades, and piglin bartering via dedicated event listeners.

---

## Leaderboard (`/money top`)

The rich list is built asynchronously on a configurable interval and cached in memory, so the command is always fast regardless of server size. Results are paginated at 10 entries per page.

- Cache refresh interval is set by `top-update-interval-seconds` in `config.yml` (default 300 s).
- The interval is re-applied immediately when `/money reload` is run.
- Before each refresh, all pending balance changes are flushed to disk so the leaderboard reflects up-to-date data.

---

## Storage

Balances are stored as individual YAML files under `plugins/kMoney/players/<uuid>.yml`. The economy manager keeps an in-memory write-back cache:

- Reads hit the cache first; a miss loads from disk and populates the cache.
- Writes go to the cache and mark the entry dirty.
- Dirty entries are flushed to disk every 30 seconds via an async autosave task.
- All dirty entries are also flushed synchronously on plugin shutdown.
- Balances can never go negative; `removeBalance` clamps at zero.

---

## Sounds

Every economy action plays a configurable sound to the involved players. Sounds are defined in `sounds.yml`.

| Event | Default sound |
|---|---|
| `pay` | `block.note_block.pling` |
| `add` | `block.note_block.chime` |
| `set` | `block.note_block.pling` |
| `remove` | `block.note_block.chime` |
| `withdraw` | `entity.item.pickup` |
| `redeem` (claim check) | `entity.player.levelup` |
| `top` | `block.note_block.pling` |
| `reload` | `entity.player.levelup` |

Each sound entry supports `enabled`, `sound` (Minecraft sound key), `pitch` (0.1–2.0), and `volume`. The entire system can be disabled by setting `enabled: false` at the top of `sounds.yml`.

---

## Messages & Formatting

All player-facing text is defined in `messages.yml` using the [MiniMessage](https://docs.advntr.dev/minimessage/format.html) format.

- Every message automatically receives the global `prefix`.
- Item lore (check name/value) uses raw messages without the prefix.
- Setting `small-font: true` in `messages.yml` replaces all standard Latin characters with Unicode small-caps equivalents, giving a stylised in-game look without a resource pack.

### Balance display suffixes

Formatted amounts use small-caps Unicode suffixes for readability:

`ᴋ M ʙ ᴛ ǫ ǫǫ ѕ ѕѕ ᴏᴄ ɴᴏ ᴅᴄ ᴜᴅᴄ` … up to `ᴛᴠɢ` (1e72)

---

## PlaceholderAPI

When PlaceholderAPI is installed, the following placeholders are available:

| Placeholder | Returns |
|---|---|
| `%kMoney_balance%` | Raw balance (no symbol, no suffix) |
| `%kMoney_balance_formatted%` | Formatted balance with symbol and suffix |
| `%kMoney_symbol%` | The configured currency symbol |

---

## Vault

kMoney registers itself as a Vault economy provider. Any plugin that uses the Vault Economy API will automatically use kMoney's balances. Bank operations are not supported.

---

## Admin join notification

Operators with `kmoney.admin` receive a brief status message when they join:

- If the running version matches the latest release on Modrinth: confirmation message with a GitHub link.
- If a newer version is available: update notice with a clickable Modrinth download link.

Each admin can disable this notification for themselves with `/money admin off`.

---

## Configuration files

| File | Purpose |
|---|---|
| `config.yml` | Currency symbol, check material, default balance, leaderboard interval, join-message and update-warning toggles |
| `messages.yml` | All player-facing text, prefix, small-font toggle |
| `sounds.yml` | Per-event sound keys, pitch, volume, and enable flags |

All three files are reloaded live with `/money reload`.
