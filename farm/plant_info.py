"""Approximate growth durations for common garden plants.

Each value is the number of days a plant occupies its plot from the
moment it goes into the ground (transplant or direct sow) until the
plot can be cleared and prepped for the next crop.

These are rough averages — actual times vary by cultivar, climate, and
growing conditions.  Perennials are marked with 365 (full-season
occupation) since they don't free their plot within a single year.
"""

# days from planting-in-ground to plot clearance
growth_durations: dict[str, int] = {
    # Vegetables
    "Amaranth": 90,
    "Asparagus": 365,
    "Beans": 65,
    "Broad Beans": 80,
    "Soya Beans": 90,
    "Beet": 60,
    "Broccoli": 80,
    "Brussels Sprouts": 100,
    "Cabbage": 85,
    "Carrots": 75,
    "Cauliflower": 75,
    "Celery": 100,
    "Collards": 70,
    "Corn": 85,
    "Cucumber": 65,
    "Eggplant": 80,
    "Fennel": 70,
    "Garlic": 240,
    "Kale": 65,
    "Kohlrabi": 55,
    "Leeks": 120,
    "Lettuce": 50,
    "Melons": 85,
    "Mustard": 40,
    "Onions": 100,
    "Peas": 65,
    "Pepper": 80,
    "Potatoes": 100,
    "Radish": 30,
    "Spinach": 45,
    "Squash": 90,
    "Strawberries": 365,
    "Swiss Chard": 55,
    "Tomatoes": 100,
    "Turnip": 55,
    # Herbs
    "Basil": 70,
    "Borage": 55,
    "Chamomile": 60,
    "Chervil": 45,
    "Chives": 365,
    "Cilantro": 45,
    "Dill": 55,
    "Lovage": 365,
    "Mint": 365,
    "Oregano": 365,
    "Sweet Marjoram": 80,
    "Parsley": 75,
    "Rosemary": 365,
    "Sage": 365,
    "Summer Savory": 60,
    "Sunflowers": 85,
    "Thyme": 365,
}
