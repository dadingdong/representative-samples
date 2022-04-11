import re
import argparse
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
import mysql.connector

MYDB = mysql.connector.connect(
    host='host',
    user='user',
    passwd='password',
    database='database',
)

cursor = MYDB.cursor(buffered=True)


# Получить все категории блюд.
def get_dish_categories(url: str) -> dict:
    netloc = urlparse(url).netloc

    content = requests.get(url)
    soup = BeautifulSoup(content.text, 'html.parser')

    dish_classes = {}

    for dish_class in soup.find_all(class_='sticky-menu__inner--icon'):
        class_link = dish_class.get('href')

        dish_category_name = dish_class.find(class_='sticky-menu__inner--icon--descr').text

        dish_classes[dish_category_name] = f'https://{netloc}{class_link}'

    return dish_classes


# Добавить категорию блюд в базу.
def dump_dish_category(dish_category_name: str) -> int:
    global region_id

    cursor.execute(
        'SELECT dish_category_id FROM dish_categories WHERE dish_category_name = %s AND region_id = %s',
        (dish_category_name, region_id))

    if result := cursor.fetchone():
        # Если уже есть в базе.
        return result[0]
    else:
        # Если еще нет в базе, то добавить.
        cursor.execute(
            'INSERT INTO dish_categories (dish_category_name, region_id) VALUES (%s, %s)',
            (dish_category_name, region_id))
        MYDB.commit()

        cursor.execute(
            'SELECT dish_category_id FROM dish_categories WHERE dish_category_name = %s AND region_id = %s',
            (dish_category_name, region_id))
        return cursor.fetchone()[0]


# Добавить ингредиент в базу.
def dump_ingredient(ingredient_name: str) -> int:
    global region_id

    cursor.execute(
        'SELECT ingredient_id FROM ingredients WHERE ingredient_name = %s AND region_id = %s',
        (ingredient_name, region_id))

    if result := cursor.fetchone():
        # Если уже есть в базе.
        ingredient_id = result[0]
    else:
        # Если еще нет в базе, то добавить.
        cursor.execute(
            'INSERT INTO ingredients (ingredient_name, region_id) VALUES (%s, %s)',
            (ingredient_name, region_id)
            )
        MYDB.commit()

        cursor.execute(
            'SELECT ingredient_id FROM ingredients WHERE ingredient_name = %s AND region_id = %s',
            (ingredient_name, region_id))
        ingredient_id = cursor.fetchone()[0]

    return ingredient_id


# Добавить блюдо в базу.
def dump_dish(dish_features: dict, dish_category_id) -> None:
    global region_id

    dish_name = dish_features['name']
    dish_image = dish_features['image']

    cursor.execute(
        'SELECT dish_id FROM dishes WHERE dish_name = %s AND dish_category_id = %s',
        (dish_name, dish_category_id))

    if not cursor.fetchone():
        # Если еще нет в базе, то добавить.
        cursor.execute(
            'INSERT INTO dishes (dish_name, image, dish_category_id) VALUES (%s, %s, %s)',
            (dish_name, dish_image, dish_category_id))
        MYDB.commit()

        cursor.execute(
            'SELECT dish_id FROM dishes WHERE dish_name = %s AND dish_category_id = %s',
            (dish_name, dish_category_id))
        dish_id = cursor.fetchone()[0]

        # Пройтись по всем ингредиентам и добавить каждый.
        for i in dish_features['ingredients']:
            ingredient_id = dump_ingredient(i.capitalize(), dish_category_id)

            cursor.execute(
                'INSERT INTO dish_to_ingredient (dish_id, ingredient_id) VALUES (%s, %s)',
                (dish_id, ingredient_id))
            MYDB.commit()

        print(f'{dish_name} of {dish_category_id} has been added')
    else:
        # Если уже есть в базе.
        print(f'{dish_name} of {dish_category_id} already exists')


# Запарсить категорию блюд со страницы на сайте.
def parse_dish_category(
        url: str, dish_category_name: str, class_link: str) -> None:
    dish_category_id = dump_dish_category(dish_category_name)

    netloc = urlparse(url).netloc

    content = requests.get(class_link)
    soup = BeautifulSoup(content.text, 'html.parser')

    category_dishes = []

    # Найти каждое блюдо на странице и обработать.
    for dish_container in soup.find_all(class_='card--grid'):
        if dish_name_raw := dish_container.find(class_='card__name'):
            dish_name = dish_name_raw.text
            dish_image = dish_container.find(class_='card__image').find('img').get('src')

            dish_ingredients = dish_container.find(
                class_='card__ingredients').contents[0].split(', ')

            dish_features = {
                'name': dish_name, 'ingredients': dish_ingredients,
                'image': dish_image,}
            category_dishes.append(dish_features)

    for i in category_dishes:
        dump_dish(i, dish_category_id)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()

    parser.add_argument('--region', help='region\'s id', type=int)
    parser.add_argument('--link', help='link to the website', type=str)

    args = parser.parse_args()

    region_id: int = args.region
    url: str = args.link

    if region_id is None or url is None:
        raise Exception('Required parameters: --region <int> and --link <url>.')

    if not url.startswith('https://'):
        url = f'https://{url}'

    print(f'Region: {region_id}, URL: {url}')

    dish_category_dict = {}
    dish_category_pages: dict = get_dish_categories(url)

    for k, v in dish_category_pages.items():
        print(f'{k:-^50}')
        parse_dish_category(url, dish_category_dict, k, v)
