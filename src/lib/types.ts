export interface Photo {
  id: number
  name: string
  url: string
  isCover: boolean
  order_column: number
}

export interface AgeGroup {
  id: number
  name: string
  name_with_duration?: string
}

export interface AgeGroup {
  id: number
  name: string
  /** e.g. "Adult (1-10 years)" — present on some records. */
  name_with_duration?: string
}

/**
 * Summary record returned by the available-animals endpoint.
 */
export interface Animal {
  name: string
  adoptable: number | boolean
  breed: string | null
  secondary_breed: string | null
  primary_color: string | null
  secondary_color: string | null
  sex: string
  species: string
  /** Unix timestamp (seconds) of birth. Sometimes delivered as a numeric string. */
  birthday: number | string | null
  /** Unix timestamp (seconds) of intake, if recorded. */
  intake_date: number | string | null
  location: string | null
  campus: string | null
  weight_group: string | null
  uniqueId: string
  nid: number
  public_url: string
  photos: Record<string, Photo>
  age_group?: AgeGroup | null
}

/**
 * Full record scraped from the animal's detail page.
 * Everything in `Animal` plus bio/fee/weight data.
 */
export interface AnimalDetail extends Animal {
  kennel_description?: string
  adoptionFee?: number | string | null
  weight?: number | string | null
  weight_units?: string | null
  videos: unknown[]
}
