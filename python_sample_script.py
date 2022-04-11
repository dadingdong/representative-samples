import sys
import argparse
import logging
from itertools import permutations
import time
import json
import datetime
from datetime import timezone, tzinfo

from redis import Redis
import requests
import numpy as np
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from pymongo import MongoClient
from bson.objectid import ObjectId

redis = Redis(host='localhost', port=6379, db=7)
mongo = MongoClient('url')

MATRIX_PERSISTENCE_PERIOD = 21600


class Units:
    MINUTES = 'minutes'
    DELIVERIES = 'deliveries'
    ALL = 'all'


class Methods:
    GRAPHHOPPER = 'graphhopper'
    GOOGLE = 'google'
    GOOGLE_TRAFFIC = 'google_traffic'
    YANDEX = 'yandex'


class TransportationModes:
    DRIVING = 'driving'
    WALKING = 'walking'
    TRANSIT = 'transit'


# Достать значения матриц времени и расстояний из Redis (с учетом сервиса
# и метода передвижения).
def get_matrix_from_redis(
        point_data: list, method=Methods.GRAPHHOPPER,
        transportation_mode=TransportationModes.DRIVING,
        include_distances=False) -> np.array:
    # Достать список координат.
    coordinates = [i['coordinates'] for i in point_data]

    # Преобразовать название ключа под Redis.
    redis_appropriate_method = method.replace('_', '-')

    time_data = []
    distance_data = []

    for i in coordinates:
        time_data.append([])
        distance_data.append([])

        for j in coordinates:
            if i == j:
                # Координата в саму себя подразумевает 0 времени и 0 расстояния.
                time_data[-1].append(0)

                if include_distances:
                    distance_data[-1].append(0)
            else:
                # Если пара отличающихся координат.

                # Создать ключ.
                pair_str = (f'{redis_appropriate_method}:{transportation_mode}:'
                            + '|'.join(sorted((i, j))))

                # Достать время из Redis.
                if time := redis.get(f'time-data:{pair_str}'):
                    time_data[-1].append(int(time))
                else:
                    raise Exception('Incomplete time data.')

                # Достать расстояние из Redis (если нужно).
                if include_distances:
                    if distance := redis.get(f'distance-data:{pair_str}'):
                        distance_data[-1].append(int(distance))
                    else:
                        raise Exception('Incomplete distance data.')

    # Время в секундах.
    time_matrix = np.array(time_data)

    if include_distances:
        distance_matrix = np.array(distance_data)
        return time_matrix, distance_matrix
    else:
        return time_matrix
